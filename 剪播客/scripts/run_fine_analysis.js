#!/usr/bin/env node
/**
 * Fine analysis - RULES LAYER ONLY
 * Handles: silence detection, basic stutter detection (consecutive identical words)
 *
 * Semantic analysis (sentence-start fillers, self-correction, in-sentence repeats,
 * residual sentences, repeated sentences) is handled by the LLM layer.
 *
 * Usage: node run_fine_analysis.js [--analysis-dir DIR]
 *
 * Output: fine_analysis_rules.json (merged with LLM output by merge_llm_fine.js)
 */

const fs = require('fs');
const path = require('path');

// Parse args (same convention as merge_llm_fine.js)
let analysisDir = process.cwd();
const dirArgIdx = process.argv.indexOf('--analysis-dir');
if (dirArgIdx >= 0 && process.argv[dirArgIdx + 1]) {
  analysisDir = path.resolve(process.argv[dirArgIdx + 1]);
}

const wordsPath = path.join(analysisDir, '../1_转录/subtitles_words.json');
const sentencesPath = path.join(analysisDir, 'sentences.txt');
const analysisPath = path.join(analysisDir, 'semantic_deep_analysis.json');
const outputPath = path.join(analysisDir, 'fine_analysis_rules.json');

const allWords = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
const sentenceLines = fs.readFileSync(sentencesPath, 'utf8').split('\n').filter(Boolean);
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

// Get deleted sentence indices from 5a
const deletedSentences = new Set(
  analysis.sentences.filter(s => s.action === 'delete').map(s => s.sentenceIdx)
);

const actualWords = allWords.filter(w => !w.isGap && !w.isSpeakerLabel);
const gaps = allWords.filter(w => w.isGap);

// User preferences
const SILENCE_THRESHOLD = 0.8;
const SILENCE_CAP = 0.8;

// === Stutter exemption tiers ===

// Tier 1: 叠词白名单 — blanket exempt, never flag
const REDUPLICATED_WORDS = new Set([
  '妈妈', '爸爸', '宝宝', '哥哥', '姐姐', '弟弟', '奶奶', '爷爷',
  '叔叔', '阿姨', '婆婆', '公公', '舅舅', '姑姑', '伯伯',
  '谢谢', '星星', '多多', '甜甜', '乖乖', '饭饭',
  '试试', '看看', '想想', '说说', '聊聊', '走走', '听听', '等等',
  '谈谈', '讲讲', '写写', '读读', '坐坐', '玩玩', '猜猜', '问问',
  '哈哈', '嘻嘻', '呵呵', '嘿嘿', '噗噗',
]);

// Tier 2: 高频词/短语 — NO blanket exemption anymore!
// Rules layer catches them ALL, marks needsReview=true for LLM to decide.
// "我我觉得" → catch + needsReview (LLM 大多数会确认删除)
// "就是就是" → catch + needsReview (LLM 根据语境判断)
const MAYBE_NATURAL_REPEATS = new Set([
  '我', '你', '他', '她', '它', '就', '去', '不', '也', '都', '在', '又', '很', '太', '但', '还',
  '是', '有', '会', '能', '要', '想', '做', '说', '看', '来', '拉',
]);
const MAYBE_NATURAL_PHRASES = new Set([
  '就是', '怎么', '真的是', '真的', '然后', '可能', '其实', '应该', '已经', '这样',
]);

// Tier 3: 数字 — blanket exempt (e.g. "2022" split into "2","0","2","2")
const NUMBER_CHARS = /^[\d一二三四五六七八九十百千万亿零两几多半]+$/;

// English word detection (avoid false positives on "OPEN"+"EN", "THIS"+"IS")
const ENGLISH_WORD = /^[A-Za-z]+$/;

// Parse sentences
const sentences = sentenceLines.map(line => {
  const parts = line.split('|');
  const [startIdx, endIdx] = parts[1].split('-').map(Number);
  return {
    idx: parseInt(parts[0]),
    wordRange: [startIdx, endIdx],
    speaker: parts[2],
    text: parts[3],
    words: actualWords.slice(startIdx, endIdx + 1),
    startTime: actualWords[startIdx] ? actualWords[startIdx].start : 0,
    endTime: actualWords[endIdx] ? actualWords[endIdx].end : 0,
  };
});

const edits = [];
let editIdx = 0;

function getNextSentenceStart(sentIdx) {
  for (let i = sentIdx + 1; i < sentences.length; i++) {
    return sentences[i].startTime;
  }
  return sentences[sentIdx].endTime;
}

// === RULE 0: Sentence-start filler detection (句首填充词) ===
// Catches: 对，/ 嗯，/ 啊，/ 呃，/ 额，/ 哦，/ 噢，/ 对呀，/ 哎，/ 诶，/ 唉，/ 欸，
// These are the #1 edit type (146 in gold) and 100% deterministic
const FILLER_START_SINGLES = ['嗯', '啊', '呃', '额', '哦', '噢', '哎', '诶', '唉', '欸', '唔'];
const FILLER_START_MULTI = ['对呀', '对对对', '嗯嗯嗯', '嗯嗯', '对对', '啊对'];
// "对" alone needs context check
const FILLER_START_AMBIGUOUS = ['对'];

for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const words = sent.words;
  if (words.length < 2) continue; // need filler + real content

  const w0 = words[0].text.replace(/[，。！？、：；]/g, '');
  if (!w0) continue;

  let fillerWordCount = 0;
  let fillerText = '';
  let isAmbiguous = false;

  // Check multi-word fillers first (longer match first)
  const first2 = words.length >= 2 ? (w0 + words[1].text.replace(/[，。！？、：；]/g, '')) : '';
  const first3 = words.length >= 3 ? (first2 + words[2].text.replace(/[，。！？、：；]/g, '')) : '';

  if (FILLER_START_MULTI.some(f => first3 === f) && words.length > 3) {
    fillerWordCount = 3;
    fillerText = words.slice(0, 3).map(w => w.text).join('');
  } else if (FILLER_START_MULTI.some(f => first2 === f) && words.length > 2) {
    fillerWordCount = 2;
    fillerText = words.slice(0, 2).map(w => w.text).join('');
  } else if (FILLER_START_SINGLES.includes(w0)) {
    fillerWordCount = 1;
    fillerText = words[0].text;
  } else if (FILLER_START_AMBIGUOUS.includes(w0)) {
    fillerWordCount = 1;
    fillerText = words[0].text;
    isAmbiguous = true;
  }

  if (fillerWordCount === 0) continue;

  // Check there's real content after the filler
  const remainingWords = words.slice(fillerWordCount);
  const remainingText = remainingWords.map(w => w.text.replace(/[，。！？、：；]/g, '')).join('');
  if (remainingText.length < 2) continue; // too short to be real content

  const deleteWords = words.slice(0, fillerWordCount);
  const globalStart = sent.wordRange[0];
  const globalEnd = sent.wordRange[0] + fillerWordCount - 1;

  edits.push({
    idx: editIdx++,
    sentenceIdx: sent.idx,
    type: 'filler_start',
    rule: '2-填充词(句首)',
    wordRange: [globalStart, globalEnd],
    deleteText: fillerText,
    keepText: '',
    deleteStart: parseFloat(deleteWords[0].start.toFixed(2)),
    deleteEnd: parseFloat(deleteWords[deleteWords.length - 1].end.toFixed(2)),
    reason: `句首填充词"${w0}"，后接实质内容`,
    needsReview: isAmbiguous,
    reviewHint: isAmbiguous ? `句首"对"可能是回应也可能是口头禅，请根据上下文判断` : undefined,
    confidence: isAmbiguous ? 0.8 : 0.95
  });
}

// === RULE: Silence detection (>0.8s) ===
for (const gap of gaps) {
  const duration = gap.end - gap.start;
  if (duration <= SILENCE_THRESHOLD) continue;

  let sentIdx = -1;
  for (let i = 0; i < sentences.length; i++) {
    if (deletedSentences.has(i)) continue;
    const s = sentences[i];
    if (gap.start >= s.startTime - 0.5 && gap.start <= getNextSentenceStart(i) + 0.5) {
      sentIdx = i;
    }
  }
  if (sentIdx < 0 || deletedSentences.has(sentIdx)) continue;

  const deleteStart = gap.start + SILENCE_CAP;
  const deleteEnd = gap.end;
  if (deleteEnd - deleteStart < 0.1) continue;

  edits.push({
    idx: editIdx++,
    sentenceIdx: sentIdx,
    type: 'silence',
    rule: '3-静音段处理',
    duration: parseFloat(duration.toFixed(1)),
    deleteStart: parseFloat(gap.start.toFixed(2)),
    deleteEnd: parseFloat(gap.end.toFixed(2)),
    keepDuration: SILENCE_CAP,
    reason: `静音${duration.toFixed(1)}秒，cap到${SILENCE_CAP}秒`
  });
}

// === RULE 1: Exact-match stutter detection (consecutive identical words) ===
// Design: catch ALL repeats, only blanket-exempt 叠词 and numbers.
// High-freq words/phrases: catch + needsReview=true → LLM decides.
for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const words = sent.words;

  for (let i = 0; i < words.length - 1; i++) {
    const curr = words[i].text;
    const next = words[i + 1].text;

    if (curr === next && curr.length >= 1) {
      // Count total consecutive repeats
      let endRepeat = i + 1;
      while (endRepeat + 1 < words.length && words[endRepeat + 1].text === curr) {
        endRepeat++;
      }
      const repeatCount = endRepeat - i + 1; // total occurrences
      const combined = curr + next;

      // === Blanket exemptions (never flag) ===
      if (REDUPLICATED_WORDS.has(combined)) { i = endRepeat; continue; }
      if (NUMBER_CHARS.test(curr)) { i = endRepeat; continue; }
      // ABB叠词豁免: 单字且前一个词不同 → "粉嘟嘟" 结构
      if (repeatCount === 2 && curr.length === 1 && i > 0 && words[i - 1].text !== curr) {
        i = endRepeat; continue;
      }

      // === Determine needsReview ===
      let needsReview = false;
      let reviewHint = '';
      if (repeatCount === 2) {
        if (curr.length === 1 && MAYBE_NATURAL_REPEATS.has(curr)) {
          needsReview = true;
          reviewHint = `单字高频词"${curr}"2x，可能是自然口语（如回应"对对"），请根据语境判断`;
        } else if (MAYBE_NATURAL_PHRASES.has(curr)) {
          needsReview = true;
          reviewHint = `高频短语"${curr}"2x，大多数情况是卡顿，但如"怎么怎么做"可能是修辞`;
        }
      }

      // Create one edit PER repeated word (not one for all).
      // This lets users individually toggle each repeat in the review page.
      // Delete words[i] through words[endRepeat-1], keep words[endRepeat] (last occurrence).
      for (let j = i; j < endRepeat; j++) {
        const globalIdx = sent.wordRange[0] + j;
        const edit = {
          idx: editIdx++,
          sentenceIdx: sent.idx,
          type: 'stutter',
          rule: '5-卡顿词',
          wordRange: [globalIdx, globalIdx],
          deleteText: words[j].text,
          keepText: curr,
          deleteStart: parseFloat(words[j].start.toFixed(2)),
          deleteEnd: parseFloat(words[j].end.toFixed(2)),
          reason: `"${curr}"连续重复${repeatCount}次，保留最后一次`
        };
        if (needsReview) {
          edit.needsReview = true;
          edit.reviewHint = reviewHint;
          edit.confidence = 0.7;
        }
        edits.push(edit);
      }

      i = endRepeat;
    }
  }
}

// === RULE 2: Suffix-match stutter detection (ASR分词边界问题) ===
// e.g. "在这个" + "这个" → 后缀 "这个" 重复
// e.g. "也开始" + "开始" → 后缀 "开始" 重复
for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const words = sent.words;

  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].text.replace(/[，。！？、：；""''（）\s]/g, '');
    const w2 = words[i + 1].text.replace(/[，。！？、：；""''（）\s]/g, '');
    if (!w1 || !w2) continue;
    if (w1 === w2) continue; // already handled by exact match
    if (w1.length <= w2.length) continue; // w1 must be longer

    // Skip English words (avoid "OPEN"+"EN", "THIS"+"IS")
    if (ENGLISH_WORD.test(w1) || ENGLISH_WORD.test(w2)) continue;

    // Check if w1 ends with w2 and w2 is ≥2 chars
    if (w1.endsWith(w2) && w2.length >= 2) {
      const globalIdx = sent.wordRange[0] + i + 1;
      // Check no existing edit overlaps this word
      const alreadyCovered = edits.some(e =>
        e.sentenceIdx === sent.idx &&
        Math.max(words[i + 1].start, e.deleteStart || 0) < Math.min(words[i + 1].end, e.deleteEnd || 0)
      );
      if (alreadyCovered) continue;

      edits.push({
        idx: editIdx++,
        sentenceIdx: sent.idx,
        type: 'stutter',
        rule: '5-卡顿词(后缀匹配)',
        wordRange: [globalIdx, globalIdx],
        deleteText: w2,
        keepText: w2,
        deleteStart: parseFloat(words[i + 1].start.toFixed(2)),
        deleteEnd: parseFloat(words[i + 1].end.toFixed(2)),
        reason: `后缀匹配："${w1}"末尾与"${w2}"重复`,
        needsReview: true,
        reviewHint: `ASR分词边界问题：第一个词"${w1}"末尾已含"${w2}"，第二个词"${w2}"是重复`,
        confidence: 0.8
      });
    }
  }
}

// === RULE 3: Mid-sentence filler detection (句中孤立填充词) ===
// Catches: 啊/呃/额/对/哦 appearing mid-sentence as hesitation fillers
// Based on 2-填充词检测.md rules
const MID_FILLERS = new Set(['啊', '呃', '额', '对', '哦']);

for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const words = sent.words;
  if (words.length < 3) continue; // need prev + filler + next

  for (let i = 1; i < words.length - 1; i++) {
    const w = words[i].text.replace(/[，。！？、：；]/g, '');
    if (!MID_FILLERS.has(w)) continue;

    // Skip if word is too long (>0.5s = emphasis/exclamation)
    const duration = words[i].end - words[i].start;
    if (duration > 0.5) continue;

    // Skip if already covered by another edit
    const alreadyCovered = edits.some(e =>
      e.sentenceIdx === sent.idx &&
      Math.abs(e.deleteStart - words[i].start) < 0.1
    );
    if (alreadyCovered) continue;

    const globalIdx = sent.wordRange[0] + i;

    // "对" needs extra care: skip if sentence is very short (likely a response "对，对")
    if (w === '对') {
      const realWords = words.filter(wd => wd.text.replace(/[，。！？、：；]/g, '').length > 0);
      if (realWords.length <= 3) continue; // short sentence, "对" is likely a response
    }

    edits.push({
      idx: editIdx++,
      sentenceIdx: sent.idx,
      type: 'stutter',
      rule: '2-填充词(句中)',
      wordRange: [globalIdx, globalIdx],
      deleteText: words[i].text,
      keepText: '',
      deleteStart: parseFloat(words[i].start.toFixed(2)),
      deleteEnd: parseFloat(words[i].end.toFixed(2)),
      reason: `句中填充词"${w}"，前后有实质内容，犹豫/换气`,
      needsReview: w === '对', // "对" more ambiguous than 啊/呃
      reviewHint: w === '对' ? '句中口头禅"对"，请确认不是对话回应' : undefined,
      confidence: w === '对' ? 0.7 : 0.9
    });
  }
}

// === RULE 4: Phrase-level repeat detection (短语级句内重复) ===
// Catches: "可以去可以去"、"放到台面来说，放到台面上来说"
// Based on 6-句内重复检测.md
//
// Strategy: catch broadly (≥3 chars), use confidence/needsReview to let LLM decide.
// Only hard-filter pure function-word phrases (e.g. "的一个") that are always structural.
const FUNCTION_WORDS_ONLY = /^[的了在是有一个这那些于与和为也到上下中不么什]+$/;

for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const text = sent.text.replace(/[，。！？、：；""''（）\s]/g, '');
  if (text.length < 8) continue; // need at least 4+4

  let bestMatch = null;

  // Find longest repeating phrase (≥3 chars, search from long to short)
  for (let len = Math.min(Math.floor(text.length / 2), 20); len >= 3; len--) {
    for (let start = 0; start <= text.length - len * 2; start++) {
      const phrase = text.slice(start, start + len);

      // Skip if phrase is all same char (already caught by word-level stutter)
      if (new Set(phrase).size === 1) continue;

      // Hard filter: pure function-word phrases are always structural, not repeats
      if (FUNCTION_WORDS_ONLY.test(phrase)) continue;

      const nextPos = text.indexOf(phrase, start + len);
      if (nextPos < 0) continue;

      // Gap between two occurrences should be small (≤ phrase length * 2)
      const gap = nextPos - start - len;
      if (gap > len * 2) continue;

      // Skip if this is a natural pattern (AABB, rhetorical repetition)
      // e.g. "越来越" is not a stutter
      if (len <= 3 && gap === 0) continue; // "越来越来" etc handled by word rules

      if (!bestMatch || len > bestMatch.len) {
        bestMatch = { phrase, start, nextPos, len, gap };
      }
    }
    if (bestMatch) break; // found longest match
  }

  if (!bestMatch) continue;

  // Map character positions back to word positions
  // We need to find the words that correspond to the first occurrence
  const origText = sent.text;
  let charCount = 0;
  const cleanToOrig = []; // maps clean-text index to original-text index
  for (let j = 0; j < origText.length; j++) {
    const c = origText[j];
    if (!/[，。！？、：；""''（）\s]/.test(c)) {
      cleanToOrig[charCount] = j;
      charCount++;
    }
  }

  // Find word indices for the delete range (first occurrence + gap)
  const deleteOrigStart = cleanToOrig[bestMatch.start] || 0;
  const deleteOrigEnd = cleanToOrig[bestMatch.nextPos - 1] || origText.length;

  // Find which words fall in the delete range
  let deleteWordStart = -1, deleteWordEnd = -1;
  let cumLen = 0;
  for (let wi = 0; wi < sent.words.length; wi++) {
    const wText = sent.words[wi].text;
    const wOrigStart = origText.indexOf(wText, cumLen);
    cumLen = wOrigStart + wText.length;

    if (wOrigStart <= deleteOrigStart && deleteWordStart < 0) deleteWordStart = wi;
    if (wOrigStart <= deleteOrigEnd) deleteWordEnd = wi;
  }

  if (deleteWordStart < 0 || deleteWordEnd < 0 || deleteWordStart >= sent.words.length) continue;
  // Don't delete if it covers the whole sentence
  if (deleteWordStart === 0 && deleteWordEnd >= sent.words.length - 1) continue;

  // Check overlap with existing edits
  const overlapExists = edits.some(e =>
    e.sentenceIdx === sent.idx && e.type !== 'silence' &&
    e.deleteStart < sent.words[deleteWordEnd].end &&
    e.deleteEnd > sent.words[deleteWordStart].start
  );
  if (overlapExists) continue;

  const deleteWords = sent.words.slice(deleteWordStart, deleteWordEnd + 1);
  const deleteTextFull = deleteWords.map(w => w.text).join('');

  // Confidence heuristics:
  // - Short phrase (3-4 chars) or large gap → more likely natural → lower confidence
  // - Long phrase (≥5 chars) with small gap → almost certainly oral stutter → higher confidence
  // - Phrase starting with structural particle (的/了) → likely structural → needsReview
  const isShort = bestMatch.len <= 4;
  const isLargeGap = bestMatch.gap > bestMatch.len;
  const startsWithParticle = ['的', '了'].includes(bestMatch.phrase[0]);
  const isHighConf = bestMatch.len >= 5 && bestMatch.gap <= 3 && !startsWithParticle;

  edits.push({
    idx: editIdx++,
    sentenceIdx: sent.idx,
    type: 'in_sentence_repeat',
    rule: '6-句内重复(短语级)',
    wordRange: [sent.wordRange[0] + deleteWordStart, sent.wordRange[0] + deleteWordEnd],
    deleteText: deleteTextFull,
    keepText: bestMatch.phrase,
    deleteStart: parseFloat(deleteWords[0].start.toFixed(2)),
    deleteEnd: parseFloat(deleteWords[deleteWords.length - 1].end.toFixed(2)),
    reason: `短语"${bestMatch.phrase}"重复，删第一次+间隔(${bestMatch.gap}字gap)`,
    needsReview: !isHighConf,
    reviewHint: isHighConf ? undefined : `短语"${bestMatch.phrase}"出现两次(${bestMatch.gap}字gap)，可能是口误重复也可能是并列/强调结构，请根据语境判断`,
    confidence: isHighConf ? 0.9 : (isShort || startsWithParticle ? 0.5 : 0.7)
  });
}

// === RULE 5: Consecutive filler detection (连续填充词) ===
// Catches: "嗯啊"、"呃啊"、"嗯嗯嗯"、"这个这个这个" (≥3 consecutive filler words)
const CONSEC_FILLERS = new Set(['嗯', '啊', '呃', '额', '哦', '噢', '唔', '这个', '就是', '然后']);

for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const words = sent.words;
  if (words.length < 2) continue;

  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].text.replace(/[，。！？、：；]/g, '');
    const w2 = words[i + 1].text.replace(/[，。！？、：；]/g, '');

    // Both must be filler words and different (same = handled by stutter rule)
    if (!CONSEC_FILLERS.has(w1) || !CONSEC_FILLERS.has(w2)) continue;
    if (w1 === w2) continue; // handled by exact-match stutter

    // Extend the run
    let runEnd = i + 1;
    while (runEnd + 1 < words.length) {
      const wn = words[runEnd + 1].text.replace(/[，。！？、：；]/g, '');
      if (CONSEC_FILLERS.has(wn)) { runEnd++; } else break;
    }

    // Check no overlap with existing edits
    const overlapExists = edits.some(e =>
      e.sentenceIdx === sent.idx && e.type !== 'silence' &&
      e.deleteStart < words[runEnd].end && e.deleteEnd > words[i].start
    );
    if (overlapExists) { i = runEnd; continue; }

    const deleteWords = words.slice(i, runEnd + 1);
    const deleteText = deleteWords.map(w => w.text).join('');

    edits.push({
      idx: editIdx++,
      sentenceIdx: sent.idx,
      type: 'consecutive_filler',
      rule: '7-连续填充词',
      wordRange: [sent.wordRange[0] + i, sent.wordRange[0] + runEnd],
      deleteText,
      keepText: '',
      deleteStart: parseFloat(deleteWords[0].start.toFixed(2)),
      deleteEnd: parseFloat(deleteWords[deleteWords.length - 1].end.toFixed(2)),
      reason: `连续填充词"${deleteText}"`,
      needsReview: false,
      confidence: 0.95
    });

    i = runEnd; // skip past this run
  }
}

// === RULE: Restart marker detection (A + 重启信号 + A) ===
// Pattern: speaker says something, then "等一下"/"重来" etc., then repeats.
// Delete the first occurrence + restart marker.
const RESTART_MARKERS = new Set([
  '等一下', '重来', '再说一遍', '再来', '重新说', '重新来',
  '等等', '不对', '说错了', '我重说', '再来一遍',
]);

for (const sent of sentences) {
  if (deletedSentences.has(sent.idx)) continue;
  const words = sent.words;
  if (words.length < 4) continue; // need at least: A marker A

  for (let m = 1; m < words.length - 1; m++) {
    // Check single-word and two-word markers
    let markerLen = 0;
    const w1 = words[m].text.replace(/[，。！？、]/g, '');
    const w2 = m + 1 < words.length ? (w1 + words[m + 1].text.replace(/[，。！？、]/g, '')) : '';

    if (RESTART_MARKERS.has(w2) && m + 1 < words.length - 1) {
      markerLen = 2;
    } else if (RESTART_MARKERS.has(w1)) {
      markerLen = 1;
    }
    if (markerLen === 0) continue;

    // Found a restart marker at position m (length markerLen)
    // Compare text before marker vs text after marker
    const beforeStart = 0;
    const beforeEnd = m; // exclusive
    const afterStart = m + markerLen;

    if (afterStart >= words.length) continue;

    // Get text snippets (first N words before and after marker)
    const compareLen = Math.min(beforeEnd - beforeStart, words.length - afterStart, 5);
    if (compareLen < 1) continue;

    const beforeText = words.slice(beforeEnd - compareLen, beforeEnd)
      .map(w => w.text.replace(/[，。！？、]/g, '')).join('');
    const afterText = words.slice(afterStart, afterStart + compareLen)
      .map(w => w.text.replace(/[，。！？、]/g, '')).join('');

    // Check similarity: at least 60% character overlap
    const overlap = [...beforeText].filter(c => afterText.includes(c)).length;
    const similarity = overlap / Math.max(beforeText.length, 1);

    if (similarity >= 0.6) {
      const deleteWords = words.slice(beforeStart, afterStart);
      const deleteText = deleteWords.map(w => w.text).join('');
      const keepWords = words.slice(afterStart);
      const keepText = keepWords.map(w => w.text).join('');

      // Check for duplicate with existing stutter edits
      const dupExists = edits.some(e =>
        e.sentenceIdx === sent.idx &&
        Math.abs(e.deleteStart - deleteWords[0].start) < 0.1
      );
      if (dupExists) continue;

      edits.push({
        idx: editIdx++,
        sentenceIdx: sent.idx,
        type: 'self_correction',
        rule: '8-重说纠正(restart-marker)',
        wordRange: [sent.wordRange[0] + beforeStart, sent.wordRange[0] + afterStart - 1],
        deleteText,
        keepText,
        deleteStart: parseFloat(deleteWords[0].start.toFixed(2)),
        deleteEnd: parseFloat(deleteWords[deleteWords.length - 1].end.toFixed(2)),
        reason: `重启信号"${words.slice(m, m + markerLen).map(w => w.text).join('')}"前后文本相似(${(similarity * 100).toFixed(0)}%)，删第一遍+信号词`
      });
      break; // one restart per sentence
    }
  }
}

// === Boundary extension for non-silence edits ===
// ASR timestamps have onset leaking (actual sound starts before reported .start)
// and there's often a gap between filler.end and next_word.start.
// Extend to [prev_word.end, next_word.start] for clean cuts without plosives.
// See MEMORY.md: "填充词删除范围必须扩展到相邻词边界"
const MAX_EXTEND_GAP = 0.20; // only extend if gap < 200ms (avoid eating real pauses)

for (const e of edits) {
  if (e.type === 'silence') continue; // silence boundaries are already precise
  if (!e.wordRange) continue;

  const sent = sentences.find(s => s.idx === e.sentenceIdx);
  if (!sent || !sent.words) continue;

  const localStart = e.wordRange[0] - sent.wordRange[0];
  const localEnd = e.wordRange[1] - sent.wordRange[0];

  // Extend start: snap to prev word's end (if close enough)
  if (localStart > 0) {
    const prevWord = sent.words[localStart - 1];
    const gap = e.deleteStart - prevWord.end;
    if (gap >= 0 && gap < MAX_EXTEND_GAP) {
      e.deleteStart = parseFloat(prevWord.end.toFixed(2));
    }
  }

  // Extend end: snap to next word's start (if close enough)
  if (localEnd < sent.words.length - 1) {
    const nextWord = sent.words[localEnd + 1];
    const gap = nextWord.start - e.deleteEnd;
    if (gap >= 0 && gap < MAX_EXTEND_GAP) {
      e.deleteEnd = parseFloat(nextWord.start.toFixed(2));
    }
  }
}

// Sort edits by time
edits.sort((a, b) => a.deleteStart - b.deleteStart);
edits.forEach((e, i) => e.idx = i);

// Summary
const byType = {};
let needsReviewCount = 0;
for (const e of edits) {
  byType[e.type] = (byType[e.type] || 0) + 1;
  if (e.needsReview) needsReviewCount++;
}

const totalTimeSaved = edits.reduce((sum, e) => {
  if (e.type === 'silence') {
    return sum + (e.duration - e.keepDuration);
  }
  return sum + (e.deleteEnd - e.deleteStart);
}, 0);

const result = {
  edits,
  summary: {
    totalEdits: edits.length,
    needsReview: needsReviewCount,
    byType,
    estimatedTimeSaved: `${Math.floor(totalTimeSaved / 60)}:${String(Math.floor(totalTimeSaved % 60)).padStart(2, '0')}`
  }
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`✅ Rules layer complete: ${outputPath}`);
console.log(`   Total edits: ${edits.length} (${needsReviewCount} needsReview → LLM decides)`);
console.log(`   By type:`, JSON.stringify(byType));
console.log(`   Estimated time saved: ${result.summary.estimatedTimeSaved}`);

// Show needsReview items for visibility
if (needsReviewCount > 0) {
  console.log(`\n   🔍 needsReview items (LLM will decide):`);
  edits.filter(e => e.needsReview).forEach(e => {
    console.log(`      S${e.sentenceIdx}: "${e.deleteText}" — ${e.reviewHint}`);
  });
}

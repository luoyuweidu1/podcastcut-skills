#!/usr/bin/env node
/**
 * Merge LLM fine analysis with rules-based fine analysis.
 *
 * Usage: node merge_llm_fine.js [--analysis-dir DIR]
 *
 * Inputs (in analysis dir):
 *   - fine_analysis_rules.json  (from run_fine_analysis.js)
 *   - fine_analysis_llm.json    (from Claude LLM session)
 *   - sentences.txt
 *   - ../1_转录/subtitles_words.json
 *
 * Output:
 *   - fine_analysis.json (merged, deduplicated, with timestamps)
 */

const fs = require('fs');
const path = require('path');

// Parse args
let analysisDir = process.cwd();
const dirArgIdx = process.argv.indexOf('--analysis-dir');
if (dirArgIdx >= 0 && process.argv[dirArgIdx + 1]) {
  analysisDir = path.resolve(process.argv[dirArgIdx + 1]);
}

const rulesPath = path.join(analysisDir, 'fine_analysis_rules.json');
const llmPath = path.join(analysisDir, 'fine_analysis_llm.json');
const sentencesPath = path.join(analysisDir, 'sentences.txt');
const wordsPath = path.join(analysisDir, '../1_转录/subtitles_words.json');
const outputPath = path.join(analysisDir, 'fine_analysis.json');

// Load data
const allWords = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
const actualWords = allWords.filter(w => !w.isGap && !w.isSpeakerLabel);
const sentenceLines = fs.readFileSync(sentencesPath, 'utf8').split('\n').filter(Boolean);

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

// Load rules-based edits
let rulesEdits = [];
if (fs.existsSync(rulesPath)) {
  const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  rulesEdits = rulesData.edits || [];
  console.log(`📐 Rules layer: ${rulesEdits.length} edits`);
} else {
  console.log(`⚠️  No rules file found at ${rulesPath}`);
}

// Load LLM edits and map text → timestamps
let llmEdits = [];
if (fs.existsSync(llmPath)) {
  const llmData = JSON.parse(fs.readFileSync(llmPath, 'utf8'));
  const llmRaw = llmData.edits || llmData; // support both {edits:[]} and bare array
  console.log(`🤖 LLM layer: ${llmRaw.length} raw edits`);

  let mapped = 0, failed = 0;
  for (const edit of llmRaw) {
    const sentIdx = edit.s;
    const deleteText = edit.text;
    const sent = sentences.find(s => s.idx === sentIdx);

    if (!sent) {
      console.warn(`   ⚠️ Sentence ${sentIdx} not found, skipping`);
      failed++;
      continue;
    }

    // Map text to timestamps
    const result = mapTextToTimestamps(sent, deleteText);
    if (!result) {
      console.warn(`   ⚠️ Could not map "${deleteText}" in sentence ${sentIdx}: "${sent.text.substring(0, 40)}..."`);
      failed++;
      continue;
    }

    const feEntry = {
      idx: 0, // re-indexed later
      sentenceIdx: sentIdx,
      type: edit.type || 'llm_edit',
      rule: `LLM-${edit.type || 'edit'}`,
      wordRange: result.wordRange,
      deleteText: deleteText,
      keepText: edit.keepText || '',
      deleteStart: result.ds,
      deleteEnd: result.de,
      reason: edit.reason || ''
    };

    // For whole-sentence deletions (single_filler, residual_sentence)
    if (edit.type === 'single_filler' || edit.type === 'residual_sentence') {
      feEntry.deleteStart = sent.startTime;
      feEntry.deleteEnd = sent.endTime;
      feEntry.wordRange = sent.wordRange;
      feEntry.wholeSentence = true;
    }

    llmEdits.push(feEntry);
    mapped++;
  }
  console.log(`   ✅ Mapped: ${mapped}, ⚠️ Failed: ${failed}`);
} else {
  console.log(`⚠️  No LLM file found at ${llmPath}`);
}

// Merge + deduplicate
const allEdits = [...rulesEdits, ...llmEdits];

// Deduplicate: if two edits overlap in the same sentence, keep the one with more coverage
allEdits.sort((a, b) => {
  const aStart = a.deleteStart ?? a.ds ?? 0;
  const bStart = b.deleteStart ?? b.ds ?? 0;
  return aStart - bStart;
});

const merged = [];
for (const edit of allEdits) {
  const eStart = edit.deleteStart ?? edit.ds ?? 0;
  const eEnd = edit.deleteEnd ?? edit.de ?? 0;

  // Check overlap with existing merged edits in same sentence
  const overlap = merged.find(m => {
    const mStart = m.deleteStart ?? m.ds ?? 0;
    const mEnd = m.deleteEnd ?? m.de ?? 0;
    return m.sentenceIdx === edit.sentenceIdx &&
           Math.max(eStart, mStart) < Math.min(eEnd, mEnd); // time overlap
  });

  if (overlap) {
    // Keep the larger coverage edit
    const oStart = overlap.deleteStart ?? overlap.ds ?? 0;
    const oEnd = overlap.deleteEnd ?? overlap.de ?? 0;
    if ((eEnd - eStart) > (oEnd - oStart)) {
      // Replace with larger edit
      const idx = merged.indexOf(overlap);
      merged[idx] = edit;
    }
    // else keep existing
    continue;
  }

  merged.push(edit);
}

// Re-index and sort
merged.sort((a, b) => {
  const aStart = a.deleteStart ?? a.ds ?? 0;
  const bStart = b.deleteStart ?? b.ds ?? 0;
  return aStart - bStart;
});
merged.forEach((e, i) => e.idx = i);

// === SELF-CORRECTION PRE-SCAN (Pattern 7: 同头扩展 / Same-prefix Expansion) ===
// Within each sentence, detect phrases that appear twice in a sliding window,
// where the second occurrence is longer/more complete → flag first for deletion.
// Runs AFTER rules+LLM merge, BEFORE post-merge gap cleanup.

console.log('\n🔄 Self-correction pre-scan (Pattern 7: 同头扩展)...');

/**
 * Check if a word (by its global index) is already marked for deletion in merged edits.
 */
function isWordAlreadyDeleted(globalWordIdx) {
  for (const edit of merged) {
    if (edit.wordRange) {
      const [ws, we] = edit.wordRange;
      if (globalWordIdx >= ws && globalWordIdx <= we) return true;
    }
  }
  return false;
}

/**
 * Check if a candidate overlaps with an existing self_correction edit in merged.
 */
function overlapsExistingSelfCorrection(candidateStart, candidateEnd) {
  for (const edit of merged) {
    if (edit.type !== 'self_correction') continue;
    const eStart = edit.deleteStart ?? edit.ds ?? 0;
    const eEnd = edit.deleteEnd ?? edit.de ?? 0;
    if (Math.max(candidateStart, eStart) < Math.min(candidateEnd, eEnd)) return true;
  }
  return false;
}

// Hesitation/filler words that appear between a false start and its correction
// Hesitation/filler words that appear between a false start and its correction.
// Must be narrow to avoid matching parallel structures where content words
// happen to be in the gap. '就'/'那' excluded - too common as content words.
const HESITATION_WORDS = new Set([
  '嗯', '呃', '啊', '哦', '就是', '好像', '那个', '这个',
  '就是说', '怎么说', '对', '哎', '额'
]);

let selfCorrectionEdits = [];

for (const sent of sentences) {
  const words = sent.words;
  if (!words || words.length < 4) continue; // need at least 4 words to find a repeat pair

  // Build array of non-deleted word indices (local to this sentence)
  const activeIndices = [];
  for (let i = 0; i < words.length; i++) {
    const globalIdx = sent.wordRange[0] + i;
    if (!isWordAlreadyDeleted(globalIdx)) {
      activeIndices.push(i);
    }
  }

  if (activeIndices.length < 4) continue;

  // Track which active positions have already been flagged to avoid overlapping detections
  const flaggedPositions = new Set();
  // Track positions where parallel structure was detected (skip all k for this ai)
  const parallelPositions = new Set();

  // For each starting position in active words, try prefix lengths k=5,4,3,2 (longest first)
  for (let ai = 0; ai < activeIndices.length; ai++) {
    if (flaggedPositions.has(ai)) continue;
    if (parallelPositions.has(ai)) continue;

    for (let k = 5; k >= 2; k--) {
      // Check we have k consecutive active words starting at ai
      if (ai + k > activeIndices.length) continue;

      // Extract prefix text (concatenated, punctuation-stripped)
      const prefixLocalIndices = activeIndices.slice(ai, ai + k);
      const prefixText = prefixLocalIndices
        .map(li => words[li].text.replace(/[，。！？、：；""''（）\s]/g, ''))
        .join('');

      // Must be ≥3 characters to be conservative
      if (prefixText.length < 3) continue;

      // Search forward in a tight window (max 8 active words gap for self-correction)
      const searchStart = ai + k; // start right after the prefix
      const searchEnd = Math.min(activeIndices.length, ai + k + 8);

      let found = false;
      let isParallel = false;
      for (let aj = searchStart; aj <= searchEnd - k; aj++) {
        // Extract candidate text at position aj with same length k
        const candidateLocalIndices = activeIndices.slice(aj, aj + k);
        const candidateText = candidateLocalIndices
          .map(li => words[li].text.replace(/[，。！？、：；""''（）\s]/g, ''))
          .join('');

        if (candidateText !== prefixText) continue;

        // Found same prefix! Check if second occurrence continues longer
        // (has at least 1 more active word after the shared prefix)
        const afterSecond = aj + k;
        if (afterSecond >= activeIndices.length) continue; // second occurrence is at sentence end, no expansion

        // --- PARALLEL STRUCTURE FILTER ---
        // Detects deliberate parallel/list structures like:
        //   "要么就fight，要么就flee，要么就僵住"
        //   "还能吃巧克力，还能吃番茄"
        // These are NOT self-corrections and should be skipped.

        const firstAfterPos = ai + k;
        const gapWords = []; // words between first occurrence end and second occurrence start
        for (let g = firstAfterPos; g < aj; g++) {
          gapWords.push(words[activeIndices[g]].text.replace(/[，。！？、：；""''（）\s]/g, ''));
        }
        const gapSize = aj - (ai + k);
        const hasHesitation = gapWords.some(w => HESITATION_WORDS.has(w));
        const substantiveGapWords = gapWords.filter(w => w.length > 0 && !HESITATION_WORDS.has(w));

        // Check if word immediately after each occurrence is different substantive content
        let firstContText = '';
        let secondContText = '';
        if (firstAfterPos < aj) {
          firstContText = words[activeIndices[firstAfterPos]].text.replace(/[，。！？、：；""''（）\s]/g, '');
        }
        if (afterSecond < activeIndices.length) {
          secondContText = words[activeIndices[afterSecond]].text.replace(/[，。！？、：；""''（）\s]/g, '');
        }

        const bothContinueDifferently = firstContText !== secondContText &&
          !HESITATION_WORDS.has(firstContText) &&
          !HESITATION_WORDS.has(secondContText) &&
          firstContText.length > 0 && secondContText.length > 0;

        // Rule 1: If gap has only substantive words (no hesitation), and continuations differ → parallel
        if (gapSize > 0 && !hasHesitation && bothContinueDifferently) {
          parallelPositions.add(ai);
          isParallel = true;
          break;
        }

        // Rule 2: Even with hesitation in gap, if continuations clearly differ with
        // substantive content, AND there are also substantive words in the gap → parallel
        if (gapSize > 1 && substantiveGapWords.length > 0 && bothContinueDifferently) {
          parallelPositions.add(ai);
          isParallel = true;
          break;
        }

        // Rule 3: Check for 3+ occurrences of same prefix in sentence (parallel/list pattern)
        let prefixOccurrences = 0;
        for (let scan = 0; scan <= activeIndices.length - k; scan++) {
          const scanText = activeIndices.slice(scan, scan + k)
            .map(li => words[li].text.replace(/[，。！？、：；""''（）\s]/g, ''))
            .join('');
          if (scanText === prefixText) prefixOccurrences++;
        }
        if (prefixOccurrences >= 3 && bothContinueDifferently) {
          parallelPositions.add(ai);
          isParallel = true;
          break; // 3+ repeats with different continuations = list/parallel
        }

        // --- SAME CONTINUATION FILTER ---
        // If both occurrences are followed by the exact same content, this is a
        // verbatim repeat (handled by stutter rules), not same-prefix expansion.
        if (afterSecond < activeIndices.length && firstAfterPos < aj) {
          const firstCont = words[activeIndices[firstAfterPos]].text.replace(/[，。！？、：；""''（）\s]/g, '');
          const secondCont = words[activeIndices[afterSecond]].text.replace(/[，。！？、：；""''（）\s]/g, '');
          if (firstCont === secondCont && firstCont.length > 0) {
            // Check one more word to be sure
            const f2 = firstAfterPos + 1 < aj ? activeIndices[firstAfterPos + 1] : -1;
            const s2 = afterSecond + 1 < activeIndices.length ? activeIndices[afterSecond + 1] : -1;
            if (f2 >= 0 && s2 >= 0) {
              const ft2 = words[f2].text.replace(/[，。！？、：；""''（）\s]/g, '');
              const st2 = words[s2].text.replace(/[，。！？、：；""''（）\s]/g, '');
              if (ft2 === st2) continue; // Verbatim repeat, skip
            }
          }
        }

        // Determine delete range: first occurrence + any trailing words up to second occurrence
        const deleteStartLocal = prefixLocalIndices[0];
        const deleteEndLocal = activeIndices[aj - 1]; // up to just before the second occurrence

        const deleteStartGlobal = sent.wordRange[0] + deleteStartLocal;
        const deleteEndGlobal = sent.wordRange[0] + deleteEndLocal;

        const deleteStartTime = parseFloat(words[deleteStartLocal].start.toFixed(3));
        const deleteEndTime = parseFloat(words[deleteEndLocal].end.toFixed(3));

        // Skip if overlaps with existing self_correction from LLM
        if (overlapsExistingSelfCorrection(deleteStartTime, deleteEndTime)) continue;

        // Build delete text for display
        const deleteWords = [];
        for (let li = deleteStartLocal; li <= deleteEndLocal; li++) {
          deleteWords.push(words[li].text);
        }
        const deleteText = deleteWords.join('');

        // Build keep text (second occurrence + continuation)
        const keepWords = [];
        for (let li = activeIndices[aj]; li < words.length; li++) {
          keepWords.push(words[li].text);
          if (keepWords.length > k + 3) break; // show a few words after
        }
        const keepText = keepWords.join('') + '...';

        const confidence = prefixText.length >= 4 ? 'high' : 'medium';

        selfCorrectionEdits.push({
          sentenceIdx: sent.idx,
          type: 'self_correction_rules',
          rule: '7-同头扩展',
          wordRange: [deleteStartGlobal, deleteEndGlobal],
          deleteText: deleteText,
          keepText: keepText,
          deleteStart: deleteStartTime,
          deleteEnd: deleteEndTime,
          reason: `同头扩展: "${prefixText}" 重复，第二次更完整`,
          confidence: confidence,
          prefixLength: prefixText.length,
          prefixWords: k
        });

        // Mark these positions as flagged
        for (let p = ai; p < aj; p++) flaggedPositions.add(p);
        found = true;
        break; // found match for this (ai, k)
      }
      if (found || isParallel) break; // skip smaller k values
    }
  }
}

// Deduplicate self-correction edits: if multiple candidates overlap, keep the longest
selfCorrectionEdits.sort((a, b) => a.deleteStart - b.deleteStart);
const dedupedSC = [];
for (const edit of selfCorrectionEdits) {
  const overlap = dedupedSC.find(e =>
    Math.max(e.deleteStart, edit.deleteStart) < Math.min(e.deleteEnd, edit.deleteEnd)
  );
  if (overlap) {
    // Keep the one with larger coverage
    if ((edit.deleteEnd - edit.deleteStart) > (overlap.deleteEnd - overlap.deleteStart)) {
      const idx = dedupedSC.indexOf(overlap);
      dedupedSC[idx] = edit;
    }
    continue;
  }
  dedupedSC.push(edit);
}

if (dedupedSC.length > 0) {
  // Also deduplicate against existing merged edits (time overlap)
  const finalSC = dedupedSC.filter(sc => {
    const overlap = merged.find(m => {
      const mStart = m.deleteStart ?? m.ds ?? 0;
      const mEnd = m.deleteEnd ?? m.de ?? 0;
      return m.sentenceIdx === sc.sentenceIdx &&
             Math.max(sc.deleteStart, mStart) < Math.min(sc.deleteEnd, mEnd);
    });
    return !overlap;
  });

  if (finalSC.length > 0) {
    merged.push(...finalSC);
    merged.sort((a, b) => {
      const aStart = a.deleteStart ?? a.ds ?? 0;
      const bStart = b.deleteStart ?? b.ds ?? 0;
      return aStart - bStart;
    });
    merged.forEach((e, i) => e.idx = i);

    console.log(`   Found ${finalSC.length} self-correction candidates:`);
    for (const sc of finalSC) {
      console.log(`   [S${sc.sentenceIdx}] ${sc.confidence} | delete "${sc.deleteText}" → keep "${sc.keepText}" (${sc.reason})`);
    }
  } else {
    console.log('   All candidates already covered by existing edits');
  }
} else {
  console.log('   No self-correction candidates found');
}

// Summary
const byType = {};
for (const e of merged) {
  byType[e.type] = (byType[e.type] || 0) + 1;
}

const totalTimeSaved = merged.reduce((sum, e) => {
  if (e.type === 'silence') {
    return sum + ((e.duration || 0) - (e.keepDuration || 0));
  }
  const ds = e.deleteStart ?? e.ds ?? 0;
  const de = e.deleteEnd ?? e.de ?? 0;
  return sum + (de - ds);
}, 0);

// === POST-MERGE GAP CLEANUP ===
// After all edits are determined, simulate the post-deletion timeline
// and find gaps > threshold that were created by merging adjacent silences.
// See: 用户习惯/3-静音段处理.md "合并间隙二次扫描"

console.log('\n🔍 Post-merge gap cleanup...');

// Also include 5a sentence-level deletions
const analysisPath = path.join(analysisDir, 'semantic_deep_analysis.json');
let sentenceDeleteRanges = [];
if (fs.existsSync(analysisPath)) {
  const analysis5a = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
  if (analysis5a.sentences) {
    analysis5a.sentences.forEach(s => {
      if (s.action === 'delete') {
        const sent = sentences.find(st => st.idx === s.sentenceIdx);
        if (sent && actualWords[sent.wordRange[0]] && actualWords[sent.wordRange[1]]) {
          sentenceDeleteRanges.push([
            actualWords[sent.wordRange[0]].start,
            actualWords[sent.wordRange[1]].end
          ]);
        }
      }
    });
  }
}

// Collect all delete ranges (fine edits + 5a)
let allDeleteRanges = [];
merged.forEach(e => {
  const ds = e.deleteStart ?? e.ds ?? 0;
  const de = e.deleteEnd ?? e.de ?? 0;
  if (de > ds) allDeleteRanges.push([ds, de]);
});
allDeleteRanges.push(...sentenceDeleteRanges);

// Merge overlapping ranges
allDeleteRanges.sort((a, b) => a[0] - b[0]);
let mergedRanges = [];
for (const r of allDeleteRanges) {
  if (mergedRanges.length && r[0] <= mergedRanges[mergedRanges.length - 1][1] + 0.01) {
    mergedRanges[mergedRanges.length - 1][1] = Math.max(mergedRanges[mergedRanges.length - 1][1], r[1]);
  } else {
    mergedRanges.push([...r]);
  }
}

// Check if a word is deleted
function isWordDeleted(w) {
  for (const [ds, de] of mergedRanges) {
    if (w.start >= ds - 0.01 && w.end <= de + 0.01) return true;
  }
  return false;
}

// Find gaps between consecutive kept words
const keptWords = actualWords.filter(w => !isWordDeleted(w));
const SILENCE_THRESHOLD = 0.8; // from preferences or default
let gapEdits = [];

for (let i = 1; i < keptWords.length; i++) {
  const gap = keptWords[i].start - keptWords[i - 1].end;
  if (gap > SILENCE_THRESHOLD) {
    const trimStart = parseFloat((keptWords[i - 1].end + SILENCE_THRESHOLD).toFixed(3));
    const trimEnd = parseFloat(keptWords[i].start.toFixed(3));
    const trimDur = parseFloat((trimEnd - trimStart).toFixed(3));
    if (trimDur < 0.05) continue;

    // Skip if already covered by an existing edit
    const alreadyCovered = merged.some(e => {
      const eStart = e.deleteStart ?? e.ds ?? 0;
      const eEnd = e.deleteEnd ?? e.de ?? 0;
      return Math.abs(eStart - trimStart) < 0.05 && Math.abs(eEnd - trimEnd) < 0.05;
    });
    if (alreadyCovered) continue;

    // Find sentence index
    let sentIdx = -1;
    for (const sent of sentences) {
      if (keptWords[i - 1].start >= sent.startTime - 0.01 && keptWords[i - 1].end <= sent.endTime + 0.01) {
        sentIdx = sent.idx;
        break;
      }
    }

    gapEdits.push({
      sentenceIdx: sentIdx,
      type: 'silence_merged',
      deleteStart: trimStart,
      deleteEnd: trimEnd,
      duration: trimDur,
      reason: `删除合并后间隙${gap.toFixed(2)}s→保留${SILENCE_THRESHOLD}s`
    });
  }
}

if (gapEdits.length > 0) {
  merged.push(...gapEdits);
  merged.sort((a, b) => {
    const aStart = a.deleteStart ?? a.ds ?? 0;
    const bStart = b.deleteStart ?? b.ds ?? 0;
    return aStart - bStart;
  });
  merged.forEach((e, i) => e.idx = i);

  const gapTimeSaved = gapEdits.reduce((s, e) => s + e.duration, 0);
  console.log(`   Found ${gapEdits.length} merged gaps, trimmed ${gapTimeSaved.toFixed(1)}s`);

  // Refresh byType
  byType['silence_merged'] = gapEdits.length;
} else {
  console.log('   No merged gaps found');
}

// Recalculate total time saved
const finalTimeSaved = merged.reduce((sum, e) => {
  if (e.type === 'silence') {
    return sum + ((e.duration || 0) - (e.keepDuration || 0));
  }
  const ds = e.deleteStart ?? e.ds ?? 0;
  const de = e.deleteEnd ?? e.de ?? 0;
  return sum + (de - ds);
}, 0);

const result = {
  edits: merged,
  summary: {
    totalEdits: merged.length,
    byType,
    estimatedTimeSaved: `${Math.floor(finalTimeSaved / 60)}:${String(Math.floor(finalTimeSaved % 60)).padStart(2, '0')}`,
    sources: {
      rules: rulesEdits.length,
      llm: llmEdits.length,
      selfCorrectionRules: merged.filter(e => e.type === 'self_correction_rules').length,
      afterDedup: merged.length - gapEdits.length,
      silenceMerged: gapEdits.length
    }
  }
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`\n✅ Merged fine analysis: ${outputPath}`);
console.log(`   Rules: ${rulesEdits.length} + LLM: ${llmEdits.length} + Gap: ${gapEdits.length} → Total: ${merged.length}`);
console.log(`   By type:`, JSON.stringify(byType));
console.log(`   Estimated time saved: ${result.summary.estimatedTimeSaved}`);


// === TEXT → TIMESTAMP MAPPING ===

/**
 * Map a deleteText string to word-level timestamps within a sentence.
 * Uses character offset matching to avoid short-text ambiguity.
 *
 * @param {Object} sent - Sentence object with .words[], .text, .wordRange
 * @param {string} deleteText - The text to find and map
 * @returns {{ ds: number, de: number, wordRange: [number, number] } | null}
 */
function mapTextToTimestamps(sent, deleteText) {
  const words = sent.words;
  if (!words || words.length === 0) return null;

  // Clean both texts for matching (remove punctuation that ASR may vary)
  const cleanDelete = deleteText.replace(/[，。！？、：；""''（）\s]/g, '');
  if (!cleanDelete) return null;

  // Build character-to-word mapping
  // Concatenate all word texts and track which word each char belongs to
  let charToWord = [];
  for (let wi = 0; wi < words.length; wi++) {
    const wText = words[wi].text.replace(/[，。！？、：；""''（）\s]/g, '');
    for (let ci = 0; ci < wText.length; ci++) {
      charToWord.push(wi);
    }
  }

  const fullClean = words.map(w => w.text.replace(/[，。！？、：；""''（）\s]/g, '')).join('');

  // Find the deleteText in the full sentence
  const matchIdx = fullClean.indexOf(cleanDelete);
  if (matchIdx < 0) return null;

  // Map character positions back to word indices
  const startWordIdx = charToWord[matchIdx];
  const endCharIdx = matchIdx + cleanDelete.length - 1;
  const endWordIdx = endCharIdx < charToWord.length ? charToWord[endCharIdx] : words.length - 1;

  const startWord = words[startWordIdx];
  const endWord = words[endWordIdx];

  return {
    ds: parseFloat(startWord.start.toFixed(2)),
    de: parseFloat(endWord.end.toFixed(2)),
    wordRange: [sent.wordRange[0] + startWordIdx, sent.wordRange[0] + endWordIdx]
  };
}

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

const result = {
  edits: merged,
  summary: {
    totalEdits: merged.length,
    byType,
    estimatedTimeSaved: `${Math.floor(totalTimeSaved / 60)}:${String(Math.floor(totalTimeSaved % 60)).padStart(2, '0')}`,
    sources: {
      rules: rulesEdits.length,
      llm: llmEdits.length,
      afterDedup: merged.length
    }
  }
};

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`\n✅ Merged fine analysis: ${outputPath}`);
console.log(`   Rules: ${rulesEdits.length} + LLM: ${llmEdits.length} → Merged: ${merged.length}`);
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

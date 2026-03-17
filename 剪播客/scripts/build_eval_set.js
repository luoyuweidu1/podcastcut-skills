#!/usr/bin/env node
/**
 * build_eval_set.js — 从 ai_feedback JSON 文件生成 gold standard eval set
 *
 * Usage:
 *   node build_eval_set.js feedback1.json feedback2.json ... --output eval_gold.json
 *   node build_eval_set.js --dir /path/to/feedback/ --output eval_gold.json
 *
 * 输入: ai_feedback_*.json (来自 review_enhanced.html 的用户反馈)
 * 输出: eval_gold.json — 按句子组织的 gold standard，含 expected_edits 和 false_positives
 *
 * 同一句子在多个 feedback 文件中出现时，合并所有标注（去重）
 */

const fs = require('fs');
const path = require('path');

// ─── Parse args ───────────────────────────────────────────────
let feedbackFiles = [];
let outputPath = 'eval_gold.json';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) {
    outputPath = args[++i];
  } else if (args[i] === '--dir' && args[i + 1]) {
    const dir = args[++i];
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('ai_feedback_') && f.endsWith('.json'))
      .map(f => path.join(dir, f));
    feedbackFiles.push(...files);
  } else if (args[i].endsWith('.json')) {
    feedbackFiles.push(args[i]);
  }
}

if (feedbackFiles.length === 0) {
  console.error('Usage: node build_eval_set.js feedback1.json ... --output eval_gold.json');
  console.error('       node build_eval_set.js --dir /path/to/feedback/ --output eval_gold.json');
  process.exit(1);
}

console.log(`📂 Loading ${feedbackFiles.length} feedback files...`);

// ─── Load & merge ─────────────────────────────────────────────

// Key = "audio_source::sentenceIdx"
const sentenceMap = new Map();
const sourceFiles = [];

for (const filePath of feedbackFiles) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const audioSource = data.audio_source || path.basename(filePath);
  sourceFiles.push({ file: path.basename(filePath), audio: audioSource, date: data.exported_at });

  // Process missed_catches → expected_edits
  for (const mc of (data.missed_catches || [])) {
    const key = `${audioSource}::${mc.sentenceIdx}`;
    if (!sentenceMap.has(key)) {
      sentenceMap.set(key, {
        sentenceIdx: mc.sentenceIdx,
        speaker: mc.speaker,
        fullSentence: mc.fullSentence,
        audioSource,
        expectedEdits: [],
        falsePositives: [],
      });
    }
    const entry = sentenceMap.get(key);

    // Deduplicate by selectedText + type
    const isDup = entry.expectedEdits.some(
      e => e.text === mc.selectedText && e.type === mc.type
    );
    if (!isDup) {
      entry.expectedEdits.push({
        text: mc.selectedText,
        type: mc.type,
        typeLabel: mc.typeLabel || '',
        reason: mc.reason || '',
        timestamp: mc.timestamp || null,
      });
    }
  }

  // Process restore_feedback → false_positives
  for (const rf of (data.restore_feedback || [])) {
    const key = `${audioSource}::${rf.sentenceIdx}`;
    if (!sentenceMap.has(key)) {
      // Restore without a missed_catch entry — still create sentence record
      sentenceMap.set(key, {
        sentenceIdx: rf.sentenceIdx,
        speaker: rf.speaker || '',
        fullSentence: rf.fullSentence || '',
        audioSource,
        expectedEdits: [],
        falsePositives: [],
      });
    }
    const entry = sentenceMap.get(key);

    const isDup = entry.falsePositives.some(
      e => e.text === rf.restoredText
    );
    if (!isDup) {
      entry.falsePositives.push({
        text: rf.restoredText,
        restoreType: rf.type || '',
        restoreLabel: rf.typeLabel || '',
        reason: rf.reason || '',
      });
    }
  }
}

// ─── Build output ─────────────────────────────────────────────

const sentences = Array.from(sentenceMap.values())
  .sort((a, b) => {
    if (a.audioSource !== b.audioSource) return a.audioSource.localeCompare(b.audioSource);
    return a.sentenceIdx - b.sentenceIdx;
  });

// Stats
let totalExpected = 0;
let totalFP = 0;
const typeStats = {};
for (const s of sentences) {
  totalExpected += s.expectedEdits.length;
  totalFP += s.falsePositives.length;
  for (const e of s.expectedEdits) {
    typeStats[e.type] = (typeStats[e.type] || 0) + 1;
  }
}

const output = {
  version: 'eval_gold_v1',
  generated_at: new Date().toISOString(),
  generated_from: sourceFiles,
  stats: {
    totalSentences: sentences.length,
    totalExpectedEdits: totalExpected,
    totalFalsePositives: totalFP,
    editsByType: typeStats,
  },
  sentences,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

console.log(`\n✅ Gold standard eval set generated: ${outputPath}`);
console.log(`   Sentences: ${sentences.length}`);
console.log(`   Expected edits (missed catches): ${totalExpected}`);
console.log(`   False positives (restores): ${totalFP}`);
console.log(`   Edit types:`);
for (const [t, c] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${t}: ${c}`);
}

// Audio source breakdown
const audioGroups = {};
for (const s of sentences) {
  if (!audioGroups[s.audioSource]) audioGroups[s.audioSource] = { sentences: 0, edits: 0, fps: 0 };
  audioGroups[s.audioSource].sentences++;
  audioGroups[s.audioSource].edits += s.expectedEdits.length;
  audioGroups[s.audioSource].fps += s.falsePositives.length;
}
console.log(`   By audio source:`);
for (const [audio, stats] of Object.entries(audioGroups)) {
  console.log(`     ${audio}: ${stats.sentences} sentences, ${stats.edits} edits, ${stats.fps} FPs`);
}

#!/usr/bin/env node
/**
 * eval_fine_analysis.js — 评估 LLM 精剪标记质量
 *
 * Usage:
 *   node eval_fine_analysis.js --gold eval_gold.json --predicted fine_analysis_llm.json
 *
 * 输入:
 *   --gold       eval_gold.json (由 build_eval_set.js 生成)
 *   --predicted  fine_analysis_llm.json 或 fine_analysis.json (LLM 输出)
 *
 * 输出: 终端报告 + 可选 eval_report.json
 *
 * 评估维度:
 *   1. Recall — gold expected edits 中有多少被 predicted 覆盖？
 *   2. False Positive Avoidance — gold false_positives 中有多少被 predicted 避免了？
 *   3. Boundary Accuracy — 匹配的 edits 中，删除边界是否精确？
 *   4. 按 type 细分的指标
 */

const fs = require('fs');
const path = require('path');

// ─── Parse args ───────────────────────────────────────────────
let goldPath = '';
let predictedPath = '';
let reportPath = '';
let verbose = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--gold' && args[i + 1]) goldPath = args[++i];
  else if (args[i] === '--predicted' && args[i + 1]) predictedPath = args[++i];
  else if (args[i] === '--report' && args[i + 1]) reportPath = args[++i];
  else if (args[i] === '--verbose' || args[i] === '-v') verbose = true;
}

if (!goldPath || !predictedPath) {
  console.error('Usage: node eval_fine_analysis.js --gold eval_gold.json --predicted fine_analysis_llm.json [-v] [--report eval_report.json]');
  process.exit(1);
}

// ─── Load data ────────────────────────────────────────────────
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
const predictedRaw = JSON.parse(fs.readFileSync(predictedPath, 'utf8'));

// Normalize predicted edits — support multiple formats
let predictedEdits = [];
if (Array.isArray(predictedRaw)) {
  predictedEdits = predictedRaw;
} else if (predictedRaw.edits) {
  predictedEdits = predictedRaw.edits;
} else if (predictedRaw.batches) {
  // Multi-batch format
  for (const batch of predictedRaw.batches) {
    predictedEdits.push(...(batch.edits || []));
  }
}

// Build predicted index by sentenceIdx
const predBySentence = new Map();
for (const edit of predictedEdits) {
  const idx = edit.s ?? edit.sentenceIdx;
  if (idx === undefined) continue;
  if (!predBySentence.has(idx)) predBySentence.set(idx, []);
  predBySentence.get(idx).push(edit);
}

console.log(`📊 Eval: ${gold.stats.totalExpectedEdits} gold edits, ${predictedEdits.length} predicted edits\n`);

// ─── Matching logic ───────────────────────────────────────────

/**
 * Normalize text by stripping leading/trailing punctuation and whitespace.
 * This allows fuzzy matching when gold and predicted differ in punctuation.
 */
function normalizeText(t) {
  if (!t) return '';
  // Strip leading/trailing punctuation and whitespace
  return t.replace(/^[，。、！？：；""''…\s]+/, '').replace(/[，。、！？：；""''…\s]+$/, '');
}

/**
 * Check if a predicted edit matches a gold edit.
 * Returns: 'exact' | 'partial' | 'type_only' | null
 */
function matchEdit(goldEdit, predEdit) {
  const predText = predEdit.text || predEdit.deleteText || '';
  const goldText = goldEdit.text || '';

  // Both empty = whole sentence deletion match
  if (predText === '' && goldText === '') return 'exact';

  if (!goldText || !predText) return null;

  // Exact text match
  if (predText === goldText) return 'exact';

  // Normalized exact match
  const normPred = normalizeText(predText);
  const normGold = normalizeText(goldText);
  if (normPred && normGold && normPred === normGold) return 'exact';

  // One contains the other (boundary difference)
  if (predText.includes(goldText) || goldText.includes(predText)) return 'partial';

  // Normalized containment
  if (normPred && normGold) {
    if (normPred.includes(normGold) || normGold.includes(normPred)) return 'partial';
  }

  // Overlap: at least 50% of characters overlap
  const overlap = longestCommonSubstring(goldText, predText);
  const overlapRatio = overlap.length / Math.max(goldText.length, 1);
  if (overlapRatio >= 0.5) return 'partial';

  return null;
}

function longestCommonSubstring(a, b) {
  let longest = '';
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j <= a.length; j++) {
      const sub = a.slice(i, j);
      if (b.includes(sub) && sub.length > longest.length) {
        longest = sub;
      }
    }
  }
  return longest;
}

// ─── Evaluate ─────────────────────────────────────────────────

const results = {
  // Recall tracking
  recall: { total: 0, caught: 0, missed: 0, partial: 0 },
  // False positive avoidance
  fpAvoidance: { total: 0, avoided: 0, repeated: 0 },
  // Boundary accuracy (among caught edits)
  boundary: { total: 0, exact: 0, partial: 0 },
  // By type breakdown
  byType: {},
  // Detailed missed list (for debugging)
  missedDetails: [],
  // Detailed false positive hits
  fpDetails: [],
  // Boundary error details
  boundaryErrors: [],
};

function ensureType(type) {
  if (!results.byType[type]) {
    results.byType[type] = { total: 0, caught: 0, missed: 0, partial: 0 };
  }
}

// 1. Check recall — how many gold expected_edits were caught?
for (const sentence of gold.sentences) {
  const preds = predBySentence.get(sentence.sentenceIdx) || [];

  for (const goldEdit of sentence.expectedEdits) {
    results.recall.total++;
    ensureType(goldEdit.type);
    results.byType[goldEdit.type].total++;

    // Find best match
    let bestMatch = null;
    let bestPred = null;
    for (const pred of preds) {
      const match = matchEdit(goldEdit, pred);
      if (match === 'exact') { bestMatch = 'exact'; bestPred = pred; break; }
      if (match === 'partial' && bestMatch !== 'exact') { bestMatch = 'partial'; bestPred = pred; }
    }

    if (bestMatch === 'exact') {
      results.recall.caught++;
      results.byType[goldEdit.type].caught++;
      results.boundary.total++;
      results.boundary.exact++;
    } else if (bestMatch === 'partial') {
      results.recall.caught++;
      results.recall.partial++;
      results.byType[goldEdit.type].caught++;
      results.byType[goldEdit.type].partial++;
      results.boundary.total++;
      results.boundary.partial++;
      results.boundaryErrors.push({
        sentenceIdx: sentence.sentenceIdx,
        goldText: goldEdit.text,
        predText: bestPred.text || bestPred.deleteText || '',
        type: goldEdit.type,
        fullSentence: sentence.fullSentence,
      });
    } else {
      results.recall.missed++;
      results.byType[goldEdit.type].missed++;
      results.missedDetails.push({
        sentenceIdx: sentence.sentenceIdx,
        speaker: sentence.speaker,
        text: goldEdit.text,
        type: goldEdit.type,
        typeLabel: goldEdit.typeLabel,
        fullSentence: sentence.fullSentence,
      });
    }
  }
}

// 2. Check false positive avoidance — do we still hit known FPs?
for (const sentence of gold.sentences) {
  const preds = predBySentence.get(sentence.sentenceIdx) || [];

  for (const fp of sentence.falsePositives) {
    results.fpAvoidance.total++;
    const fpText = fp.text || '';

    let hit = false;
    for (const pred of preds) {
      const predText = pred.text || pred.deleteText || '';
      if (predText.includes(fpText) || fpText.includes(predText)) {
        hit = true;
        break;
      }
    }

    if (hit) {
      results.fpAvoidance.repeated++;
      results.fpDetails.push({
        sentenceIdx: sentence.sentenceIdx,
        text: fp.text,
        restoreType: fp.restoreType,
        reason: fp.reason,
      });
    } else {
      results.fpAvoidance.avoided++;
    }
  }
}

// 3. Check precision — how many predicted edits match at least one gold edit?
const precisionResults = { total: predictedEdits.length, matched: 0, unmatched: 0 };
for (const pred of predictedEdits) {
  const idx = pred.s ?? pred.sentenceIdx;
  if (idx === undefined) { precisionResults.unmatched++; continue; }

  const sentence = gold.sentences.find(s => s.sentenceIdx === idx);
  if (!sentence) { precisionResults.unmatched++; continue; }

  let found = false;
  for (const goldEdit of sentence.expectedEdits) {
    if (matchEdit(goldEdit, pred)) { found = true; break; }
  }
  if (found) precisionResults.matched++;
  else precisionResults.unmatched++;
}

// 4. Coverage analysis — how many gold edits could potentially be covered?
let coverageCount = 0;
for (const sentence of gold.sentences) {
  const preds = predBySentence.get(sentence.sentenceIdx) || [];
  if (preds.length === 0) {
    // No predictions for this sentence at all
    continue;
  }
  for (const goldEdit of sentence.expectedEdits) {
    const goldText = goldEdit.text || '';
    if (!goldText) { coverageCount++; continue; } // empty = sentence delete
    // Check if ANY prediction's text overlaps with this gold edit
    for (const pred of preds) {
      const predText = pred.text || pred.deleteText || '';
      if (predText.includes(goldText) || goldText.includes(predText) ||
          normalizeText(predText).includes(normalizeText(goldText))) {
        coverageCount++;
        break;
      }
    }
  }
}

// ─── Output ───────────────────────────────────────────────────

const recallRate = results.recall.total > 0 ? (results.recall.caught / results.recall.total * 100).toFixed(1) : 'N/A';
const boundaryExactRate = results.boundary.total > 0 ? (results.boundary.exact / results.boundary.total * 100).toFixed(1) : 'N/A';
const fpAvoidRate = results.fpAvoidance.total > 0 ? (results.fpAvoidance.avoided / results.fpAvoidance.total * 100).toFixed(1) : 'N/A';
const precisionRate = precisionResults.total > 0 ? (precisionResults.matched / precisionResults.total * 100).toFixed(1) : 'N/A';

console.log('═══════════════════════════════════════════════════');
console.log('  📋 精剪评估报告');
console.log('═══════════════════════════════════════════════════');
console.log();
console.log(`  Recall (漏检率):     ${results.recall.caught}/${results.recall.total} caught (${recallRate}%)`);
console.log(`    ├─ exact match:    ${results.recall.caught - results.recall.partial}`);
console.log(`    ├─ partial match:  ${results.recall.partial}  ← 边界有偏差但检出了`);
console.log(`    └─ missed:         ${results.recall.missed}  ← 完全漏检`);
console.log();
console.log(`  Precision (误标率):    ${precisionResults.matched}/${precisionResults.total} matched (${precisionRate}%)`);
console.log(`    └─ unmatched preds: ${precisionResults.unmatched}  ← 预测了但gold中没有`);
console.log();
console.log(`  Boundary (边界准确率): ${results.boundary.exact}/${results.boundary.total} exact (${boundaryExactRate}%)`);
console.log(`    └─ boundary errors: ${results.boundary.partial}  ← 检出了但删多/删少`);
console.log();
console.log(`  FP Avoidance (误删避免): ${results.fpAvoidance.avoided}/${results.fpAvoidance.total} avoided (${fpAvoidRate}%)`);
console.log(`    └─ still hitting:  ${results.fpAvoidance.repeated}  ← 已知误删仍在重犯`);
console.log();
console.log(`  Coverage (潜在覆盖):   ${coverageCount}/${results.recall.total} gold edits have overlapping predictions`);
console.log();

// By type breakdown
console.log('───────────────────────────────────────────────────');
console.log('  按类型细分:');
console.log('───────────────────────────────────────────────────');

const typeEntries = Object.entries(results.byType).sort((a, b) => b[1].total - a[1].total);
console.log(`  ${'Type'.padEnd(22)} ${'Total'.padStart(5)} ${'Caught'.padStart(7)} ${'Missed'.padStart(7)} ${'Recall'.padStart(8)} ${'Boundary'.padStart(9)}`);
for (const [type, stats] of typeEntries) {
  const recall = stats.total > 0 ? (stats.caught / stats.total * 100).toFixed(0) + '%' : 'N/A';
  const exact = stats.caught > 0 ? ((stats.caught - stats.partial) / stats.caught * 100).toFixed(0) + '%' : 'N/A';
  console.log(`  ${type.padEnd(22)} ${String(stats.total).padStart(5)} ${String(stats.caught).padStart(7)} ${String(stats.missed).padStart(7)} ${recall.padStart(8)} ${exact.padStart(9)}`);
}

// Top missed edits (most actionable)
if (results.missedDetails.length > 0 && verbose) {
  console.log();
  console.log('───────────────────────────────────────────────────');
  console.log(`  漏检详情 (前 30 条):`);
  console.log('───────────────────────────────────────────────────');
  for (const m of results.missedDetails.slice(0, 30)) {
    const preview = m.fullSentence.length > 60 ? m.fullSentence.slice(0, 60) + '...' : m.fullSentence;
    console.log(`  S${m.sentenceIdx} [${m.type}] 漏删 "${m.text}"`);
    console.log(`    句: ${preview}`);
  }
}

// Boundary errors
if (results.boundaryErrors.length > 0 && verbose) {
  console.log();
  console.log('───────────────────────────────────────────────────');
  console.log(`  边界错误详情 (前 20 条):`);
  console.log('───────────────────────────────────────────────────');
  for (const be of results.boundaryErrors.slice(0, 20)) {
    console.log(`  S${be.sentenceIdx} [${be.type}]`);
    console.log(`    期望删: "${be.goldText}"`);
    console.log(`    实际删: "${be.predText}"`);
  }
}

// FP details
if (results.fpDetails.length > 0 && verbose) {
  console.log();
  console.log('───────────────────────────────────────────────────');
  console.log(`  重犯的误删 (前 15 条):`);
  console.log('───────────────────────────────────────────────────');
  for (const fp of results.fpDetails.slice(0, 15)) {
    console.log(`  S${fp.sentenceIdx} restore "${fp.text}" (${fp.restoreType}: ${fp.reason})`);
  }
}

console.log();
console.log('═══════════════════════════════════════════════════');

// Save report
if (reportPath) {
  const report = {
    generated_at: new Date().toISOString(),
    goldFile: goldPath,
    predictedFile: predictedPath,
    summary: {
      recall: { rate: parseFloat(recallRate) || 0, ...results.recall },
      precision: { rate: parseFloat(precisionRate) || 0, ...precisionResults },
      boundaryAccuracy: { rate: parseFloat(boundaryExactRate) || 0, ...results.boundary },
      fpAvoidance: { rate: parseFloat(fpAvoidRate) || 0, ...results.fpAvoidance },
      coverage: { potential: coverageCount, total: results.recall.total },
    },
    byType: results.byType,
    missedDetails: results.missedDetails,
    boundaryErrors: results.boundaryErrors,
    fpDetails: results.fpDetails,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`📄 Detailed report saved: ${reportPath}`);
}

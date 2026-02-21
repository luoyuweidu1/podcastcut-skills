#!/usr/bin/env node
/**
 * 反馈分析器 — 从审查页的 AI 反馈 JSON 中提取偏好调整建议
 *
 * 输入: ai_feedback_*.json（由 review_enhanced.html 的"导出 AI 反馈"按钮生成）
 * 输出: 偏好调整建议（JSON），附置信度
 *
 * 反馈 JSON 格式:
 * {
 *   "missed_catches": [{ sentenceIdx, speaker, selectedText, fullSentence, type, typeLabel, reason }],
 *   "user_corrections": {
 *     "added_deletions": [sentenceIdx...],  // 用户手动添加的删除
 *     "removed_deletions": [sentenceIdx...]  // 用户撤销的 AI 删除
 *   }
 * }
 *
 * 用法:
 *   node analyze_feedback.js <feedback.json> [analysis.json] [fine_analysis.json]
 *
 * 可选参数:
 *   analysis.json — 步骤 5a 的 semantic_deep_analysis.json（用于理解被恢复删除的类型）
 *   fine_analysis.json — 步骤 5b 的 fine_analysis.json（用于理解精剪类型）
 */

const fs = require('fs');
const path = require('path');

// --- 反馈类型到 editing_rules 的映射 ---

const FEEDBACK_TYPE_TO_RULE = {
  // 精剪类型（来自 missed_catches 的 type 字段）
  in_sentence_repeat: 'filler_words',
  repeated_sentence: 'repeated_sentences',
  stutter: 'stutter',
  self_correction: 'self_correction',
  consecutive_filler: 'filler_words',
  single_filler: 'filler_words',
  silence: 'silence',
  residual_sentence: 'residual_sentences',
  // 内容类型（来自 semantic_deep_analysis 的 type 字段）
  pre_show: 'content_analysis',
  tech_debug: 'content_analysis',
  chit_chat: 'content_analysis',
  privacy: 'content_analysis',
  repeated_content: 'content_analysis',
  production_talk: 'content_analysis'
};

// --- 分析函数 ---

function analyzeFeedback(feedbackPath, analysisPath, fineAnalysisPath) {
  const feedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
  let analysis = null;
  let fineAnalysis = null;

  if (analysisPath && fs.existsSync(analysisPath)) {
    analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
  }
  if (fineAnalysisPath && fs.existsSync(fineAnalysisPath)) {
    fineAnalysis = JSON.parse(fs.readFileSync(fineAnalysisPath, 'utf8'));
  }

  const results = {
    version: 'feedback_analysis_v1',
    analyzed_at: new Date().toISOString(),
    source_file: feedbackPath,
    adjustments: [],
    summary: {
      missed_catches: (feedback.missed_catches || []).length,
      added_deletions: (feedback.user_corrections?.added_deletions || []).length,
      removed_deletions: (feedback.user_corrections?.removed_deletions || []).length
    }
  };

  // --- 分析 missed_catches（AI 遗漏） ---
  const missedByType = {};
  for (const mc of (feedback.missed_catches || [])) {
    const type = mc.type || 'unknown';
    if (!missedByType[type]) missedByType[type] = [];
    missedByType[type].push(mc);
  }

  for (const [type, items] of Object.entries(missedByType)) {
    const targetRule = FEEDBACK_TYPE_TO_RULE[type] || 'unknown';
    results.adjustments.push({
      direction: 'increase_detection',
      target_rule: targetRule,
      feedback_type: type,
      count: items.length,
      confidence: Math.min(0.5 + items.length * 0.1, 0.95),
      reason: `AI 遗漏了 ${items.length} 个 "${type}" 类型的内容`,
      examples: items.slice(0, 3).map(i => ({
        text: i.selectedText?.slice(0, 50) || '',
        sentence: i.fullSentence?.slice(0, 80) || ''
      }))
    });
  }

  // --- 分析 removed_deletions（用户恢复了 AI 删除的） ---
  const removedIndices = feedback.user_corrections?.removed_deletions || [];
  if (removedIndices.length > 0 && analysis) {
    // 查找被恢复句子的原始删除类型
    const removedByType = {};
    const sentenceMap = {};

    if (analysis.sentences) {
      for (const s of analysis.sentences) {
        if (s.action === 'delete') {
          sentenceMap[s.sentenceIdx] = s;
        }
      }
    }

    for (const idx of removedIndices) {
      const original = sentenceMap[idx];
      if (original) {
        const type = original.type || 'content_block';
        if (!removedByType[type]) removedByType[type] = [];
        removedByType[type].push({ idx, reason: original.reason });
      }
    }

    for (const [type, items] of Object.entries(removedByType)) {
      const targetRule = FEEDBACK_TYPE_TO_RULE[type] || 'content_analysis';
      results.adjustments.push({
        direction: 'decrease_aggressiveness',
        target_rule: targetRule,
        feedback_type: type,
        count: items.length,
        confidence: Math.min(0.5 + items.length * 0.1, 0.90),
        reason: `用户恢复了 ${items.length} 个 "${type}" 类型的 AI 删除`,
        examples: items.slice(0, 3).map(i => ({ idx: i.idx, reason: i.reason }))
      });
    }

    // 检查是否有精剪类型被恢复（从 fineAnalysis）
    if (fineAnalysis && fineAnalysis.edits) {
      const fineEditMap = {};
      for (const edit of fineAnalysis.edits) {
        fineEditMap[edit.sentenceIdx] = edit;
      }

      const removedFineByType = {};
      for (const idx of removedIndices) {
        const fineEdit = fineEditMap[idx];
        if (fineEdit) {
          const type = fineEdit.type || 'unknown';
          if (!removedFineByType[type]) removedFineByType[type] = [];
          removedFineByType[type].push(fineEdit);
        }
      }

      for (const [type, items] of Object.entries(removedFineByType)) {
        const targetRule = FEEDBACK_TYPE_TO_RULE[type] || 'filler_words';
        results.adjustments.push({
          direction: 'decrease_aggressiveness',
          target_rule: targetRule,
          feedback_type: type,
          count: items.length,
          confidence: Math.min(0.5 + items.length * 0.15, 0.90),
          reason: `用户恢复了 ${items.length} 个精剪 "${type}" 类型的删除`,
          examples: items.slice(0, 3).map(i => ({
            text: i.deleteText?.slice(0, 30) || '',
            rule: i.rule
          }))
        });
      }
    }
  }

  // --- 分析 added_deletions（用户新增的删除） ---
  const addedCount = feedback.user_corrections?.added_deletions?.length || 0;
  if (addedCount > 3) {
    results.adjustments.push({
      direction: 'increase_aggressiveness',
      target_rule: 'content_analysis',
      feedback_type: 'user_added',
      count: addedCount,
      confidence: Math.min(0.4 + addedCount * 0.05, 0.80),
      reason: `用户手动新增了 ${addedCount} 个删除，可能需要提高整体激进度`
    });
  }

  // --- 过滤低置信度建议 ---
  results.adjustments = results.adjustments.filter(a => a.confidence >= 0.5);

  // --- 按置信度排序 ---
  results.adjustments.sort((a, b) => b.confidence - a.confidence);

  return results;
}

// --- CLI ---

if (require.main === module) {
  const feedbackPath = process.argv[2];
  const analysisPath = process.argv[3];
  const fineAnalysisPath = process.argv[4];

  if (!feedbackPath) {
    console.log(`用法: node analyze_feedback.js <feedback.json> [analysis.json] [fine_analysis.json]

分析审查页导出的 AI 反馈，生成 editing_rules 调整建议。

参数:
  feedback.json       审查页"导出 AI 反馈"生成的文件
  analysis.json       (可选) 步骤 5a 的 semantic_deep_analysis.json
  fine_analysis.json  (可选) 步骤 5b 的 fine_analysis.json

输出: JSON 格式的调整建议

示例:
  node analyze_feedback.js ai_feedback_2026-02-21.json \\
      semantic_deep_analysis.json fine_analysis.json`);
    process.exit(1);
  }

  if (!fs.existsSync(feedbackPath)) {
    console.error(`❌ 文件不存在: ${feedbackPath}`);
    process.exit(1);
  }

  const results = analyzeFeedback(feedbackPath, analysisPath, fineAnalysisPath);

  // 输出人类可读摘要到 stderr
  console.error(`\n📊 反馈分析结果:`);
  console.error(`   AI 遗漏: ${results.summary.missed_catches}`);
  console.error(`   用户新增删除: ${results.summary.added_deletions}`);
  console.error(`   用户恢复删除: ${results.summary.removed_deletions}`);
  console.error(`   调整建议: ${results.adjustments.length} 条\n`);

  for (const adj of results.adjustments) {
    const arrow = adj.direction.includes('increase') ? '↑' : '↓';
    console.error(`   ${arrow} [${adj.target_rule}] ${adj.reason} (置信度: ${adj.confidence.toFixed(2)})`);
  }

  // 输出完整 JSON 到 stdout
  console.log(JSON.stringify(results, null, 2));
}

module.exports = { analyzeFeedback };

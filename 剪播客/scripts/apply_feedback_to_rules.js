#!/usr/bin/env node
/**
 * 将反馈分析结果应用到用户的 editing_rules
 *
 * 读取 analyze_feedback.js 的输出，更新用户的 editing_rules/ YAML 文件。
 * 同时记录到 learning_history.json。
 *
 * 用法:
 *   node apply_feedback_to_rules.js <analysis_result.json> [userId]
 *
 * 或通过管道:
 *   node analyze_feedback.js feedback.json | node apply_feedback_to_rules.js - [userId]
 */

const fs = require('fs');
const path = require('path');
const UserManager = require('./user_manager');

// --- 激进度调整映射 ---

const AGGRESSIVENESS_LEVELS = ['conservative', 'moderate', 'aggressive'];

function adjustAggressiveness(current, direction) {
  const idx = AGGRESSIVENESS_LEVELS.indexOf(current);
  if (idx === -1) return current;

  if (direction === 'increase' && idx < AGGRESSIVENESS_LEVELS.length - 1) {
    return AGGRESSIVENESS_LEVELS[idx + 1];
  }
  if (direction === 'decrease' && idx > 0) {
    return AGGRESSIVENESS_LEVELS[idx - 1];
  }
  return current;
}

// --- 应用调整到 editing_rules ---

function applyAdjustments(userId, analysisResult) {
  const adjustments = analysisResult.adjustments || [];
  const applied = [];

  for (const adj of adjustments) {
    // 只应用高置信度的建议
    if (adj.confidence < 0.6) continue;

    const ruleName = adj.target_rule;

    // 加载现有的用户覆盖（如果有）
    const rules = UserManager.loadEditingRules(userId);
    let existingRule = rules.user_overrides[ruleName] || {};

    switch (ruleName) {
      case 'filler_words': {
        if (adj.direction === 'decrease_aggressiveness') {
          existingRule.overall_aggressiveness = adjustAggressiveness(
            existingRule.overall_aggressiveness || 'moderate', 'decrease'
          );
          existingRule._last_adjustment = {
            date: new Date().toISOString().slice(0, 10),
            reason: adj.reason,
            direction: adj.direction
          };
        } else if (adj.direction === 'increase_detection') {
          // AI 遗漏了填充词，增加检测
          if (!existingRule.additional_patterns) existingRule.additional_patterns = [];
          for (const ex of (adj.examples || [])) {
            if (ex.text && !existingRule.additional_patterns.includes(ex.text)) {
              existingRule.additional_patterns.push(ex.text);
            }
          }
        }
        break;
      }

      case 'silence': {
        if (adj.direction === 'decrease_aggressiveness') {
          const current = existingRule.threshold_seconds || 3.0;
          existingRule.threshold_seconds = Math.min(current + 0.5, 6.0);
          existingRule._last_adjustment = {
            date: new Date().toISOString().slice(0, 10),
            reason: adj.reason,
            direction: adj.direction
          };
        } else if (adj.direction === 'increase_detection') {
          const current = existingRule.threshold_seconds || 3.0;
          existingRule.threshold_seconds = Math.max(current - 0.5, 1.5);
        }
        break;
      }

      case 'content_analysis': {
        if (adj.direction === 'decrease_aggressiveness') {
          existingRule.aggressiveness = adjustAggressiveness(
            existingRule.aggressiveness || 'moderate', 'decrease'
          );
          // 记录哪些类型被过度删除
          if (!existingRule.over_deleted_types) existingRule.over_deleted_types = [];
          if (adj.feedback_type && !existingRule.over_deleted_types.includes(adj.feedback_type)) {
            existingRule.over_deleted_types.push(adj.feedback_type);
          }
        } else if (adj.direction === 'increase_aggressiveness') {
          existingRule.aggressiveness = adjustAggressiveness(
            existingRule.aggressiveness || 'moderate', 'increase'
          );
        }
        existingRule._last_adjustment = {
          date: new Date().toISOString().slice(0, 10),
          reason: adj.reason,
          direction: adj.direction
        };
        break;
      }

      case 'stutter':
      case 'self_correction':
      case 'repeated_sentences':
      case 'residual_sentences': {
        if (adj.direction === 'increase_detection') {
          existingRule.sensitivity = (existingRule.sensitivity || 'moderate');
          existingRule.missed_count = (existingRule.missed_count || 0) + adj.count;
        } else if (adj.direction === 'decrease_aggressiveness') {
          existingRule.sensitivity = adjustAggressiveness(
            existingRule.sensitivity || 'moderate', 'decrease'
          );
        }
        existingRule._last_adjustment = {
          date: new Date().toISOString().slice(0, 10),
          reason: adj.reason,
          direction: adj.direction
        };
        break;
      }
    }

    // 标记来源
    existingRule._source = existingRule._source || 'feedback_learning';

    // 保存到用户的 editing_rules
    UserManager.saveEditingRule(userId, ruleName, existingRule);

    applied.push({
      rule: ruleName,
      direction: adj.direction,
      confidence: adj.confidence,
      reason: adj.reason
    });
  }

  // 记录学习事件
  if (applied.length > 0) {
    UserManager.appendLearningEvent(userId, {
      type: 'feedback_learning',
      source_file: analysisResult.source_file || '',
      adjustments_applied: applied,
      summary: analysisResult.summary
    });
  }

  return applied;
}

// --- CLI ---

if (require.main === module) {
  let inputPath = process.argv[2];
  const userId = process.argv[3] || UserManager.getCurrentUser();

  if (!inputPath) {
    console.log(`用法: node apply_feedback_to_rules.js <analysis_result.json> [userId]

将反馈分析结果应用到用户的 editing_rules。

参数:
  analysis_result.json   analyze_feedback.js 的输出（或用 - 表示 stdin）
  userId                 用户 ID（默认从环境变量读取）

示例:
  # 两步执行
  node analyze_feedback.js feedback.json > analysis.json
  node apply_feedback_to_rules.js analysis.json lixiang

  # 管道执行
  node analyze_feedback.js feedback.json 2>/dev/null | node apply_feedback_to_rules.js - lixiang`);
    process.exit(1);
  }

  // 支持 stdin
  let rawInput;
  if (inputPath === '-') {
    rawInput = fs.readFileSync(0, 'utf8');  // read from stdin
  } else {
    if (!fs.existsSync(inputPath)) {
      console.error(`❌ 文件不存在: ${inputPath}`);
      process.exit(1);
    }
    rawInput = fs.readFileSync(inputPath, 'utf8');
  }

  if (!UserManager.userExists(userId)) {
    console.error(`❌ 用户 "${userId}" 不存在`);
    process.exit(1);
  }

  const analysisResult = JSON.parse(rawInput);
  const applied = applyAdjustments(userId, analysisResult);

  if (applied.length === 0) {
    console.error('ℹ️  没有需要应用的调整（所有建议置信度不足或无变更）');
    process.exit(0);
  }

  console.error(`\n✅ 已应用 ${applied.length} 条调整到用户 "${userId}" 的 editing_rules:`);
  for (const a of applied) {
    const arrow = a.direction.includes('increase') ? '↑' : '↓';
    console.error(`   ${arrow} [${a.rule}] ${a.reason}`);
  }

  const configPath = UserManager.getUserConfigPath(userId);
  console.error(`\n📂 更新的文件: ${configPath}/editing_rules/`);
  console.error(`📝 学习记录: ${configPath}/learning_history.json`);

  // 输出应用结果到 stdout
  console.log(JSON.stringify({ applied, userId }, null, 2));
}

module.exports = { applyAdjustments };

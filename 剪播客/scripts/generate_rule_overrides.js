#!/usr/bin/env node
/**
 * 从 learned_patterns.json 生成用户级 editing_rules YAML 文件
 *
 * 读取样本分析结果，将统计规律转化为具体的 editing_rules 覆盖文件。
 * 生成的文件会叠加到全局基础规则之上。
 *
 * 用法:
 *   node generate_rule_overrides.js <learned_patterns.json> [userId]
 *
 * 输出:
 *   用户偏好/[userId]/editing_rules/filler_words.yaml
 *   用户偏好/[userId]/editing_rules/silence.yaml
 *   用户偏好/[userId]/editing_rules/content_analysis.yaml
 */

const fs = require('fs');
const path = require('path');
const UserManager = require('./user_manager');

// --- 激进度到数值的映射 ---

const AGGRESSIVENESS_MAP = {
  conservative: { filler_base_rate: 0.3, silence_threshold: 4.0, content_reduction: 0.15 },
  moderate:     { filler_base_rate: 0.5, silence_threshold: 3.0, content_reduction: 0.25 },
  aggressive:   { filler_base_rate: 0.8, silence_threshold: 2.0, content_reduction: 0.40 }
};

// --- 生成 filler_words 覆盖 ---

function generateFillerWordsOverride(patterns) {
  const analysis = patterns.filler_word_analysis || {};
  const recs = (patterns.recommendations || []).filter(r => r.rule === 'filler_words');

  const highDeletion = [];
  const moderateDeletion = [];
  const preserve = [];

  for (const [word, data] of Object.entries(analysis)) {
    if (data.rate >= 0.6) {
      highDeletion.push({ word, deletion_rate: data.rate, sample_count: data.total });
    } else if (data.rate >= 0.3) {
      moderateDeletion.push({ word, deletion_rate: data.rate, sample_count: data.total });
    } else {
      preserve.push({ word, deletion_rate: data.rate, sample_count: data.total });
    }
  }

  return {
    _source: 'sample_learning',
    _generated_at: new Date().toISOString().slice(0, 10),
    _confidence: 0.85,
    high_deletion: highDeletion,
    moderate_deletion: moderateDeletion,
    preserve: preserve,
    overall_aggressiveness: patterns.aggressiveness || 'moderate'
  };
}

// --- 生成 silence 覆盖 ---

function generateSilenceOverride(patterns) {
  const silenceAnalysis = patterns.silence_analysis || {};

  return {
    _source: 'sample_learning',
    _generated_at: new Date().toISOString().slice(0, 10),
    _confidence: silenceAnalysis.estimated_threshold ? 0.75 : 0.5,
    threshold_seconds: silenceAnalysis.estimated_threshold || 3.0,
    deleted_count_in_sample: silenceAnalysis.deleted_silence_count || 0,
    sample_durations: (silenceAnalysis.silence_durations || []).slice(0, 5)
  };
}

// --- 生成 content_analysis 覆盖 ---

function generateContentAnalysisOverride(patterns) {
  const summary = patterns.summary || {};
  const types = patterns.deletion_types || {};

  return {
    _source: 'sample_learning',
    _generated_at: new Date().toISOString().slice(0, 10),
    _confidence: 0.80,
    overall_reduction_percent: summary.reduction_percent || 0,
    aggressiveness: patterns.aggressiveness || 'moderate',
    detected_types: Object.fromEntries(
      Object.entries(types).map(([type, data]) => [
        type,
        { count: data.count, duration_seconds: data.total_duration }
      ])
    )
  };
}

// --- 主逻辑 ---

function generateOverrides(patternsPath, userId) {
  const patterns = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));

  const fillerWords = generateFillerWordsOverride(patterns);
  const silence = generateSilenceOverride(patterns);
  const contentAnalysis = generateContentAnalysisOverride(patterns);

  // 保存到用户的 editing_rules 目录
  UserManager.saveEditingRule(userId, 'filler_words', fillerWords);
  UserManager.saveEditingRule(userId, 'silence', silence);
  UserManager.saveEditingRule(userId, 'content_analysis', contentAnalysis);

  // 同时更新 preferences.yaml 的激进度（如果样本分析的结果与现有不同）
  const prefs = UserManager.loadPreferences(userId);
  if (prefs && patterns.aggressiveness) {
    const currentAgg = prefs.duration && prefs.duration.aggressiveness;
    if (currentAgg !== patterns.aggressiveness) {
      console.error(`\n💡 建议: 根据样本分析，激进度应为 "${patterns.aggressiveness}"（当前: "${currentAgg}"）`);
      console.error(`   可通过编辑 preferences.yaml 的 duration.aggressiveness 更新`);
    }
  }

  const configPath = UserManager.getUserConfigPath(userId);
  console.error(`\n✅ 已生成 editing_rules 覆盖文件:`);
  console.error(`   ${configPath}/editing_rules/filler_words.yaml`);
  console.error(`   ${configPath}/editing_rules/silence.yaml`);
  console.error(`   ${configPath}/editing_rules/content_analysis.yaml`);

  // 记录学习事件
  UserManager.appendLearningEvent(userId, {
    type: 'sample_learning',
    patterns_file: patternsPath,
    rules_generated: ['filler_words', 'silence', 'content_analysis'],
    aggressiveness: patterns.aggressiveness,
    reduction_percent: patterns.summary.reduction_percent
  });

  return { fillerWords, silence, contentAnalysis };
}

// --- CLI ---

if (require.main === module) {
  const patternsPath = process.argv[2];
  const userId = process.argv[3] || UserManager.getCurrentUser();

  if (!patternsPath) {
    console.log(`用法: node generate_rule_overrides.js <learned_patterns.json> [userId]

从样本分析结果生成用户级 editing_rules 覆盖文件。

示例:
  node generate_rule_overrides.js learned_patterns.json lixiang`);
    process.exit(1);
  }

  if (!fs.existsSync(patternsPath)) {
    console.error(`❌ 文件不存在: ${patternsPath}`);
    process.exit(1);
  }

  if (!UserManager.userExists(userId)) {
    console.error(`❌ 用户 "${userId}" 不存在，请先创建: node user_manager.js create ${userId}`);
    process.exit(1);
  }

  const result = generateOverrides(patternsPath, userId);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { generateOverrides };

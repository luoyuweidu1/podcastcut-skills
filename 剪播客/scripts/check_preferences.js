#!/usr/bin/env node
/**
 * 检查用户偏好，判断是否需要 onboarding
 *
 * 用法:
 *   node check_preferences.js [userId]
 *
 * 输出: JSON 格式的检查结果
 * 退出码: 0 = 已配置, 1 = 需要 onboarding
 *
 * 支持两种格式：
 * - 新版 YAML (用户配置/[userId]/preferences.yaml)
 * - 旧版 Markdown (用户偏好.md) — 向后兼容
 */

const fs = require('fs');
const path = require('path');

// 优先使用新版 user_manager
let UserManager;
try {
  UserManager = require('./user_manager');
} catch (e) {
  UserManager = null;
}

const OLD_PREF_FILE = path.join(__dirname, '../用户偏好.md');

function checkNewFormat(userId) {
  if (!UserManager) return null;

  if (!UserManager.userExists(userId)) {
    return {
      exists: false,
      needsOnboarding: true,
      format: 'yaml',
      userId,
      reason: `用户 "${userId}" 不存在`
    };
  }

  const prefs = UserManager.loadPreferences(userId);
  if (!prefs) {
    return {
      exists: true,
      needsOnboarding: true,
      format: 'yaml',
      userId,
      reason: 'preferences.yaml 无法读取'
    };
  }

  const checks = {
    hasAudience: !!prefs.audience && prefs.audience !== '',
    hasPurpose: !!prefs.purpose && prefs.purpose !== '',
    hasTargetDuration: !!(prefs.duration && prefs.duration.target_minutes > 0),
    hasContentAnalysis: !!(prefs.content_analysis && prefs.content_analysis.enabled),
    hasTechOptimization: !!(prefs.technical && prefs.technical.enabled)
  };

  const isConfigured = checks.hasAudience && checks.hasPurpose && checks.hasTargetDuration;

  const rules = UserManager.loadEditingRules(userId);

  return {
    exists: true,
    needsOnboarding: !isConfigured,
    isConfigured,
    format: 'yaml',
    userId,
    configPath: UserManager.getUserConfigPath(userId),
    hasEditingOverrides: rules.has_overrides,
    checks,
    reason: isConfigured ? '用户偏好已配置' : '用户偏好未完整配置'
  };
}

function checkOldFormat() {
  if (!fs.existsSync(OLD_PREF_FILE)) {
    return {
      exists: false,
      needsOnboarding: true,
      format: 'markdown',
      reason: '用户偏好文件不存在'
    };
  }

  const content = fs.readFileSync(OLD_PREF_FILE, 'utf8');

  const checks = {
    hasAudience: /受众:\s*"(.+)"/.test(content) && !/受众:\s*""/.test(content),
    hasPurpose: /目的:\s*"(.+)"/.test(content) && !/目的:\s*""/.test(content),
    hasTargetDuration: /理想时长:\s*"(.+)"/.test(content) && !/理想时长:\s*""/.test(content),
    hasContentAnalysis: /启用内容分析:\s*true/.test(content),
    hasTechOptimization: /启用技术优化:\s*true/.test(content)
  };

  const isConfigured = checks.hasAudience && checks.hasPurpose && checks.hasTargetDuration;

  return {
    exists: true,
    needsOnboarding: !isConfigured,
    isConfigured,
    format: 'markdown',
    checks,
    reason: isConfigured ? '用户偏好已配置（旧格式）' : '用户偏好未完整配置',
    migrationHint: '建议迁移到新版 YAML 格式（用户配置/）'
  };
}

// --- 主逻辑 ---

const userId = process.argv[2] || (UserManager ? UserManager.getCurrentUser() : 'default');

// 优先检查新版 YAML 格式
let result = checkNewFormat(userId);

// 如果新版不存在或检测不到，fallback 到旧版 markdown
if (!result || (!result.exists && fs.existsSync(OLD_PREF_FILE))) {
  const oldResult = checkOldFormat();
  if (oldResult.exists) {
    result = oldResult;
  }
}

// 如果两种都不存在
if (!result) {
  result = {
    exists: false,
    needsOnboarding: true,
    format: 'none',
    userId,
    reason: '无任何偏好配置'
  };
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.needsOnboarding ? 1 : 0);

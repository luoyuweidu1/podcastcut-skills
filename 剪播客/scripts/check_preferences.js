#!/usr/bin/env node
/**
 * 检查用户偏好文件，判断是否需要onboarding
 *
 * 用法: node check_preferences.js
 * 输出: JSON格式的检查结果
 */

const fs = require('fs');
const path = require('path');

const PREF_FILE = path.join(__dirname, '../用户偏好.md');

function checkPreferences() {
  // 检查文件是否存在
  if (!fs.existsSync(PREF_FILE)) {
    return {
      exists: false,
      needsOnboarding: true,
      reason: '用户偏好文件不存在'
    };
  }

  // 读取文件内容
  const content = fs.readFileSync(PREF_FILE, 'utf8');

  // 检查关键字段是否填写
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
    isConfigured: isConfigured,
    checks: checks,
    reason: isConfigured ? '用户偏好已配置' : '用户偏好未完整配置'
  };
}

// 主函数
const result = checkPreferences();
console.log(JSON.stringify(result, null, 2));

// 返回退出码
process.exit(result.needsOnboarding ? 1 : 0);

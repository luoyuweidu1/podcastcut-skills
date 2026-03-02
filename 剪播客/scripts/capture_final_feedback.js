#!/usr/bin/env node
/**
 * capture_final_feedback.js — 阶段 8: 终审反馈捕获 → 持久化学习
 *
 * 读取终审页面导出的 final_review_feedback.json，
 * 将用户标记的问题分类后路由到对应的持久化存储：
 *   - 方法论问题 → 基础剪辑规则/ 相关文件
 *   - 个人偏好问题 → 用户偏好/<userId>/editing_rules/
 *
 * 用法:
 *   node capture_final_feedback.js \
 *     --feedback <final_review_feedback.json> \
 *     [--user <userId>]
 *
 * 依赖: user_manager.js（读写用户偏好）
 */

const fs = require('fs');
const path = require('path');
const userManager = require('./user_manager');

// --- 参数解析 ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '').replace(/-/g, '_');
    opts[key] = args[i + 1];
  }
  return opts;
}

// --- 问题分类 ---

/**
 * 将质检问题分类为方法论 vs 个人偏好
 *
 * 方法论（写入 基础剪辑规则/）：
 *   - 检测算法缺陷（漏检 stutter/filler/repetition）
 *   - 切点质量问题（energy_jump, spectral 等信号层问题）
 *   - 内容缺失（误删有价值内容）
 *
 * 个人偏好（写入 用户偏好/<userId>/）：
 *   - 残留填充词去留（有人觉得"嗯"该留，有人觉得该删）
 *   - 删除激进度调整
 *   - 特定词的保留/删除
 */
function classifyIssue(issue) {
  const type = issue.type || '';
  const layer = issue.layer || '';

  // 信号层问题 → 方法论（切点算法需要改进）
  if (layer === 'signal' || layer === 'signal_ai') {
    return 'methodology';
  }

  // 数据层问题 → 方法论（审计逻辑需要改进）
  if (layer === 'data') {
    return 'methodology';
  }

  // 语义层：内容缺失 → 方法论
  if (type === 'missing_content') {
    return 'methodology';
  }

  // 语义层：残留填充词/卡顿 → 个人偏好（是否该删取决于用户）
  if (type === 'residual_filler' || type === 'residual_stutter') {
    return 'preference';
  }

  // 默认 → 方法论
  return 'methodology';
}

// --- 反馈路由 ---

/**
 * 将方法论反馈记录到学习历史
 * （实际规则更新由 Claude 在读取反馈后判断执行）
 */
function routeMethodologyFeedback(events, userId) {
  if (events.length === 0) return;

  for (const event of events) {
    userManager.appendLearningEvent(userId, {
      source: 'final_review',
      category: 'methodology',
      type: event.type,
      layer: event.layer,
      severity: event.severity,
      detail: event.detail,
      user_note: event.note,
      user_status: event.status,
      timestamp_in_audio: event.time
    });
  }

  console.log(`  方法论反馈: ${events.length} 条 → learning_history.json`);
}

/**
 * 将个人偏好反馈记录到用户偏好
 */
function routePreferenceFeedback(events, userId) {
  if (events.length === 0) return;

  // 记录到学习历史
  for (const event of events) {
    userManager.appendLearningEvent(userId, {
      source: 'final_review',
      category: 'preference',
      type: event.type,
      detail: event.detail,
      user_note: event.note,
      user_status: event.status,
      timestamp_in_audio: event.time
    });
  }

  // 统计偏好信号
  const fillerKept = events.filter(e =>
    e.type === 'residual_filler' && e.status === 'ok'
  ).length;
  const fillerFlagged = events.filter(e =>
    e.type === 'residual_filler' && e.status === 'flagged'
  ).length;
  const stutterKept = events.filter(e =>
    e.type === 'residual_stutter' && e.status === 'ok'
  ).length;
  const stutterFlagged = events.filter(e =>
    e.type === 'residual_stutter' && e.status === 'flagged'
  ).length;

  if (fillerKept > 0 || fillerFlagged > 0) {
    console.log(`  填充词偏好信号: ${fillerKept} 个觉得可以留, ${fillerFlagged} 个觉得该删`);
  }
  if (stutterKept > 0 || stutterFlagged > 0) {
    console.log(`  卡顿偏好信号: ${stutterKept} 个觉得可以留, ${stutterFlagged} 个觉得该删`);
  }

  console.log(`  个人偏好反馈: ${events.length} 条 → learning_history.json`);
}

// --- 主逻辑 ---

function main() {
  const opts = parseArgs();

  if (!opts.feedback) {
    console.error('用法: node capture_final_feedback.js --feedback <final_review_feedback.json> [--user <userId>]');
    process.exit(1);
  }

  const userId = opts.user || userManager.getCurrentUser();

  console.log('阶段 8: 终审反馈捕获');
  console.log('='.repeat(50));
  console.log(`用户: ${userId}`);

  // 检查用户存在
  if (!userManager.userExists(userId)) {
    console.error(`用户 "${userId}" 不存在。请先运行 node user_manager.js create ${userId}`);
    process.exit(1);
  }

  // 读取反馈
  if (!fs.existsSync(opts.feedback)) {
    console.error(`反馈文件不存在: ${opts.feedback}`);
    process.exit(1);
  }

  const feedback = JSON.parse(fs.readFileSync(opts.feedback, 'utf8'));
  console.log(`反馈版本: ${feedback.version}`);
  console.log(`判定结果: ${feedback.verdict}`);
  console.log(`总问题数: ${feedback.summary?.total || 0}`);
  console.log(`  确认无问题: ${feedback.summary?.confirmed_ok || 0}`);
  console.log(`  标记有问题: ${feedback.summary?.flagged || 0}`);
  console.log(`  未处理:     ${feedback.summary?.pending || 0}`);

  // 只处理有明确状态的问题（ok 或 flagged）
  const actionableIssues = (feedback.issues || []).filter(
    i => i.status === 'ok' || i.status === 'flagged'
  );

  if (actionableIssues.length === 0) {
    console.log('\n没有可操作的反馈条目。');
    return;
  }

  // 分类
  const methodologyIssues = [];
  const preferenceIssues = [];

  for (const issue of actionableIssues) {
    const category = classifyIssue(issue);
    if (category === 'methodology') {
      methodologyIssues.push(issue);
    } else {
      preferenceIssues.push(issue);
    }
  }

  console.log(`\n分类结果:`);
  console.log(`  方法论: ${methodologyIssues.length} 条`);
  console.log(`  个人偏好: ${preferenceIssues.length} 条`);

  // 路由
  routeMethodologyFeedback(methodologyIssues, userId);
  routePreferenceFeedback(preferenceIssues, userId);

  // 记录到 episode history
  userManager.appendEpisode(userId, {
    source: 'final_review',
    verdict: feedback.verdict,
    audio_source: feedback.audio_source,
    total_issues: feedback.summary?.total || 0,
    flagged: feedback.summary?.flagged || 0,
    confirmed_ok: feedback.summary?.confirmed_ok || 0
  });

  console.log(`\n反馈已持久化到用户 "${userId}" 的记录中。`);

  if (methodologyIssues.some(i => i.status === 'flagged')) {
    console.log('\n提示: 有方法论层面的问题被标记。建议 Claude 读取 learning_history.json 并评估是否需要更新 基础剪辑规则/。');
  }
  if (preferenceIssues.some(i => i.status === 'flagged')) {
    console.log('\n提示: 有个人偏好层面的问题被标记。建议 Claude 读取 learning_history.json 并评估是否需要更新 editing_rules/。');
  }
}

main();

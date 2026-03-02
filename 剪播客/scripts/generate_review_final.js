#!/usr/bin/env node
/**
 * generate_review_final.js — 阶段 8: 用户终审页面生成
 *
 * 将质检三阶段（数据层/信号层/语义层）报告合并为一个可交互的 HTML 终审页面。
 * 用户可以：播放音频、点击时间戳跳转、逐条确认/标记问题、导出反馈。
 *
 * 用法:
 *   node generate_review_final.js \
 *     --audio <final_audio.mp3> \
 *     --audit-report <audit_report.json> \
 *     --signal-report <qa_signal_report.json> \
 *     --semantic-report <qa_semantic_report.json> \
 *     --qa-report <qa_report.json> \
 *     --words <subtitles_words.json> \
 *     --output <review_final.html>
 *
 * 输入（均可选，缺失则跳过对应层）:
 *   - audit_report.json:       Phase A 数据层质检报告
 *   - qa_signal_report.json:   Phase B 信号层质检报告
 *   - qa_semantic_report.json: Phase C 语义层质检报告
 *   - qa_report.json:          综合报告（含评分和 review_items）
 *   - subtitles_words.json:    原始转录词级时间戳（用于上下文展示）
 *   - final_audio.mp3:         成品音频路径
 *
 * 输出:
 *   review_final.html — 自包含单文件终审页面
 */

const fs = require('fs');
const path = require('path');

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

// --- 辅助函数 ---

function readJsonSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`警告: 无法读取 ${filePath}: ${e.message}`);
    return null;
  }
}

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- 提取上下文文本 ---

function getContextText(words, timeSec, windowSec = 3) {
  if (!words || !words.length) return { before: '', after: '' };

  const wordList = Array.isArray(words) ? words :
    (words.words || words.subtitles?.flatMap(s => s.words) || []);

  const actualWords = wordList.filter(w => !w.isGap && !w.isSpeakerLabel);

  // 找到最近的词
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < actualWords.length; i++) {
    const dist = Math.abs(actualWords[i].start - timeSec);
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }

  // 前后各取 windowSec 秒的词
  const beforeWords = [];
  const afterWords = [];
  for (let i = closest - 1; i >= 0; i--) {
    if (timeSec - actualWords[i].start > windowSec) break;
    beforeWords.unshift(actualWords[i].text || actualWords[i].word || '');
  }
  for (let i = closest; i < actualWords.length; i++) {
    if (actualWords[i].start - timeSec > windowSec) break;
    afterWords.push(actualWords[i].text || actualWords[i].word || '');
  }

  return {
    before: beforeWords.join(''),
    after: afterWords.join('')
  };
}

// --- 合并所有 QA 问题 ---

function collectIssues(auditReport, signalReport, semanticReport, qaReport, words) {
  const issues = [];

  // 1. 综合报告中的 review_items（优先使用，已去重+排序）
  if (qaReport && qaReport.review_items) {
    for (const item of qaReport.review_items) {
      const ctx = getContextText(words, item.time);
      issues.push({
        id: `qa-${issues.length}`,
        time: item.time,
        timeStr: item.time_str || formatTime(item.time),
        source: item.source || 'signal',
        layer: item.source === 'ai' || item.source === 'ai_confirmed' ? 'signal_ai' : 'signal',
        layerLabel: item.source === 'ai' || item.source === 'ai_confirmed' ? 'AI 听感' : '信号层',
        type: item.type,
        severity: item.severity || 'medium',
        detail: item.detail,
        suggestion: item.suggestion || '',
        listenRange: item.listen_range || [Math.max(0, item.time - 2), item.time + 2],
        contextBefore: ctx.before,
        contextAfter: ctx.after
      });
    }
  }

  // 2. 数据层审计报告（如果没有综合报告，或补充综合报告缺失的）
  if (auditReport && auditReport.checks) {
    const existingTimes = new Set(issues.map(i => Math.round(i.time * 10)));

    const addAuditIssue = (issue, layerLabel, severity) => {
      const time = issue.timeRange?.[0] || issue.gapStart || issue.start || 0;
      if (existingTimes.has(Math.round(time * 10))) return;
      const ctx = getContextText(words, time);
      issues.push({
        id: `audit-${issues.length}`,
        time,
        timeStr: formatTime(time),
        source: 'audit',
        layer: 'data',
        layerLabel: '数据层',
        type: issue.type,
        severity,
        detail: issue.note || issue.sentenceText || `${issue.beforeText || ''} → ${issue.afterText || ''}`,
        suggestion: issue.suggestion || '',
        listenRange: [Math.max(0, time - 2), time + (issue.duration || 4)],
        contextBefore: ctx.before,
        contextAfter: ctx.after
      });
    };

    // 恢复句被误剪
    for (const issue of (auditReport.checks.restoredSentences?.issues || [])) {
      addAuditIssue(issue, '数据层', 'high');
    }
    // 手动删除未生效
    for (const issue of (auditReport.checks.manualDeletions?.issues || [])) {
      addAuditIssue(issue, '数据层', 'high');
    }
    // 切点静音
    for (const issue of (auditReport.checks.cutPointSilences?.issues || [])) {
      addAuditIssue(issue, '数据层', 'medium');
    }
    // 大段删除
    for (const issue of (auditReport.checks.largeDeletions?.issues || [])) {
      addAuditIssue(issue, '数据层', 'low');
    }
  }

  // 3. 语义层报告
  if (semanticReport && semanticReport.checks) {
    const checks = semanticReport.checks;

    for (const filler of (checks.residual_fillers || [])) {
      const ctx = getContextText(words, filler.time);
      issues.push({
        id: `sem-filler-${issues.length}`,
        time: filler.time,
        timeStr: formatTime(filler.time),
        source: 'semantic',
        layer: 'semantic',
        layerLabel: '语义层',
        type: 'residual_filler',
        severity: 'medium',
        detail: `残留填充词: "${filler.text}"`,
        suggestion: '检查是否应删除',
        listenRange: [Math.max(0, filler.time - 1), filler.time + 1],
        contextBefore: ctx.before,
        contextAfter: ctx.after
      });
    }

    for (const stutter of (checks.residual_stutters || [])) {
      const ctx = getContextText(words, stutter.time);
      issues.push({
        id: `sem-stutter-${issues.length}`,
        time: stutter.time,
        timeStr: formatTime(stutter.time),
        source: 'semantic',
        layer: 'semantic',
        layerLabel: '语义层',
        type: 'residual_stutter',
        severity: 'medium',
        detail: `残留卡顿: ${stutter.context}`,
        suggestion: '检查是否应删除',
        listenRange: [Math.max(0, stutter.time - 1), stutter.time + 2],
        contextBefore: ctx.before,
        contextAfter: ctx.after
      });
    }

    for (const missing of (checks.missing_content || [])) {
      const time = missing.time_range?.[0] || 0;
      const ctx = getContextText(words, time);
      issues.push({
        id: `sem-missing-${issues.length}`,
        time,
        timeStr: formatTime(time),
        source: 'semantic',
        layer: 'semantic',
        layerLabel: '语义层',
        type: 'missing_content',
        severity: 'high',
        detail: `内容缺失: "${missing.expected}"`,
        suggestion: '检查是否误删',
        listenRange: missing.time_range || [Math.max(0, time - 3), time + 3],
        contextBefore: ctx.before,
        contextAfter: ctx.after
      });
    }
  }

  // 按严重度排序（HIGH > MEDIUM > LOW），同级按时间
  const severityOrder = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 1;
    const sb = severityOrder[b.severity] ?? 1;
    if (sa !== sb) return sa - sb;
    return a.time - b.time;
  });

  return issues;
}

// --- 生成 HTML ---

function generateHtml(issues, audioPath, qaReport, auditReport, semanticReport) {
  const totalIssues = issues.length;
  const highCount = issues.filter(i => i.severity === 'high').length;
  const mediumCount = issues.filter(i => i.severity === 'medium').length;
  const lowCount = issues.filter(i => i.severity === 'low').length;

  const signalScore = qaReport?.signal_score ?? '--';
  const aiScore = qaReport?.ai_score ?? '--';
  const overallScore = qaReport?.overall_score ?? '--';
  const duration = qaReport?.duration_seconds
    ? formatTime(qaReport.duration_seconds)
    : '--:--';

  const issuesJson = JSON.stringify(issues);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>终审 — 播客质检报告</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f8fafc; color: #1e293b;
    padding-bottom: 120px;
  }

  /* --- 顶部音频播放器 --- */
  .player-bar {
    position: sticky; top: 0; z-index: 100;
    background: #1e293b; color: #f1f5f9;
    padding: 12px 24px; display: flex; align-items: center; gap: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .player-bar audio { flex: 1; height: 36px; }
  .player-bar .speed-btn {
    background: #334155; color: #e2e8f0; border: none; border-radius: 4px;
    padding: 4px 10px; cursor: pointer; font-size: 13px;
  }
  .player-bar .speed-btn.active { background: #3b82f6; color: #fff; }
  .player-bar .current-time { font-variant-numeric: tabular-nums; min-width: 50px; }

  /* --- 统计面板 --- */
  .stats-panel {
    max-width: 960px; margin: 24px auto; padding: 20px 24px;
    background: #fff; border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px;
  }
  .stat-card { text-align: center; }
  .stat-card .stat-value {
    font-size: 28px; font-weight: 700; line-height: 1.2;
  }
  .stat-card .stat-label {
    font-size: 12px; color: #64748b; margin-top: 4px;
  }
  .score-good { color: #16a34a; }
  .score-ok { color: #f59e0b; }
  .score-bad { color: #dc2626; }

  /* --- 筛选栏 --- */
  .filter-bar {
    max-width: 960px; margin: 0 auto 16px; padding: 0 24px;
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
  }
  .filter-btn {
    background: #e2e8f0; color: #475569; border: none; border-radius: 20px;
    padding: 6px 14px; cursor: pointer; font-size: 13px; transition: all 0.15s;
  }
  .filter-btn.active { background: #3b82f6; color: #fff; }
  .filter-btn:hover { opacity: 0.85; }
  .filter-count {
    font-size: 11px; background: rgba(0,0,0,0.15); border-radius: 10px;
    padding: 1px 6px; margin-left: 4px;
  }

  /* --- 问题列表 --- */
  .issues-container { max-width: 960px; margin: 0 auto; padding: 0 24px; }
  .issue-card {
    background: #fff; border-radius: 10px; padding: 16px 20px; margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-left: 4px solid #94a3b8;
    transition: opacity 0.2s, border-color 0.2s;
  }
  .issue-card.severity-high { border-left-color: #dc2626; }
  .issue-card.severity-medium { border-left-color: #f59e0b; }
  .issue-card.severity-low { border-left-color: #16a34a; }
  .issue-card.confirmed { opacity: 0.45; }

  .issue-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;
  }
  .badge {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
    text-transform: uppercase;
  }
  .badge-high { background: #fef2f2; color: #dc2626; }
  .badge-medium { background: #fffbeb; color: #d97706; }
  .badge-low { background: #f0fdf4; color: #16a34a; }
  .badge-layer {
    background: #eff6ff; color: #2563eb; font-size: 11px;
    padding: 2px 8px; border-radius: 4px;
  }

  .time-link {
    color: #3b82f6; cursor: pointer; font-variant-numeric: tabular-nums;
    font-weight: 500; text-decoration: underline;
  }
  .time-link:hover { color: #1d4ed8; }

  .issue-detail { color: #334155; line-height: 1.6; margin-bottom: 8px; }
  .issue-suggestion { color: #64748b; font-size: 13px; font-style: italic; }

  .issue-context {
    background: #f8fafc; border-radius: 6px; padding: 10px 14px;
    margin-top: 8px; font-size: 13px; line-height: 1.6;
    display: flex; gap: 6px; align-items: baseline;
  }
  .ctx-before { color: #64748b; }
  .ctx-marker { color: #dc2626; font-weight: 700; }
  .ctx-after { color: #334155; }

  .issue-actions {
    display: flex; gap: 8px; margin-top: 10px; align-items: center;
  }
  .confirm-btn {
    font-size: 12px; padding: 4px 12px; border-radius: 4px; cursor: pointer;
    border: 1px solid #e2e8f0; background: #fff; transition: all 0.15s;
  }
  .confirm-btn:hover { background: #f1f5f9; }
  .confirm-btn.confirmed-ok {
    background: #dcfce7; border-color: #16a34a; color: #15803d;
  }
  .confirm-btn.flagged {
    background: #fef2f2; border-color: #dc2626; color: #dc2626;
  }
  .issue-note-input {
    flex: 1; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 4px;
    padding: 4px 8px; outline: none;
  }
  .issue-note-input:focus { border-color: #3b82f6; }

  /* --- 空状态 --- */
  .empty-state {
    text-align: center; padding: 60px 20px; color: #64748b;
  }
  .empty-state .icon { font-size: 48px; margin-bottom: 16px; }
  .empty-state h2 { color: #1e293b; margin-bottom: 8px; }

  /* --- 底部操作栏 --- */
  .action-bar {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #fff; border-top: 1px solid #e2e8f0;
    padding: 16px 24px; display: flex; justify-content: center; gap: 16px;
    z-index: 100;
  }
  .action-btn {
    padding: 12px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;
    cursor: pointer; border: none; transition: all 0.15s;
  }
  .btn-approve { background: #16a34a; color: #fff; }
  .btn-approve:hover { background: #15803d; }
  .btn-reject { background: #dc2626; color: #fff; }
  .btn-reject:hover { background: #b91c1c; }
  .btn-export { background: #3b82f6; color: #fff; }
  .btn-export:hover { background: #2563eb; }

  .action-bar .summary-text {
    font-size: 13px; color: #64748b; align-self: center;
  }

  /* --- 响应式 --- */
  @media (max-width: 640px) {
    .stats-panel { grid-template-columns: repeat(2, 1fr); }
    .action-bar { flex-wrap: wrap; }
    .action-btn { flex: 1; min-width: 120px; }
  }
</style>
</head>
<body>

<!-- 音频播放器 -->
<div class="player-bar">
  <span class="current-time" id="currentTime">0:00</span>
  <audio id="audioPlayer" controls preload="metadata">
    <source src="${escapeHtml(audioPath)}" type="audio/mpeg">
  </audio>
  <span id="speedControls">
    <button class="speed-btn" data-speed="0.75">0.75x</button>
    <button class="speed-btn active" data-speed="1">1x</button>
    <button class="speed-btn" data-speed="1.5">1.5x</button>
    <button class="speed-btn" data-speed="2">2x</button>
  </span>
</div>

<!-- 统计面板 -->
<div class="stats-panel">
  <div class="stat-card">
    <div class="stat-value ${getScoreClass(overallScore)}">${overallScore}</div>
    <div class="stat-label">综合评分</div>
  </div>
  <div class="stat-card">
    <div class="stat-value ${getScoreClass(signalScore)}">${signalScore}</div>
    <div class="stat-label">信号评分</div>
  </div>
  <div class="stat-card">
    <div class="stat-value ${getScoreClass(aiScore)}">${aiScore}</div>
    <div class="stat-label">AI 听感</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${duration}</div>
    <div class="stat-label">成品时长</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${totalIssues}</div>
    <div class="stat-label">待检问题</div>
  </div>
  <div class="stat-card">
    <div class="stat-value" style="color: #dc2626;">${highCount}</div>
    <div class="stat-label">HIGH</div>
  </div>
</div>

<!-- 筛选栏 -->
<div class="filter-bar">
  <button class="filter-btn active" data-filter="all">全部<span class="filter-count">${totalIssues}</span></button>
  <button class="filter-btn" data-filter="high">HIGH<span class="filter-count">${highCount}</span></button>
  <button class="filter-btn" data-filter="medium">MEDIUM<span class="filter-count">${mediumCount}</span></button>
  <button class="filter-btn" data-filter="low">LOW<span class="filter-count">${lowCount}</span></button>
  <span style="color:#cbd5e1">|</span>
  <button class="filter-btn" data-filter="data">数据层</button>
  <button class="filter-btn" data-filter="signal">信号层</button>
  <button class="filter-btn" data-filter="semantic">语义层</button>
  <button class="filter-btn" data-filter="unconfirmed">未确认</button>
</div>

<!-- 问题列表 -->
<div class="issues-container" id="issuesList">
</div>

<!-- 底部操作栏 -->
<div class="action-bar">
  <span class="summary-text" id="actionSummary">已确认 0/${totalIssues}</span>
  <button class="action-btn btn-export" onclick="exportFeedback()">导出反馈</button>
  <button class="action-btn btn-approve" onclick="approveAll()">确认无问题</button>
  <button class="action-btn btn-reject" onclick="rejectWithIssues()">需要重剪</button>
</div>

<script>
// --- 数据 ---
const issues = ${issuesJson};
const issueStates = {};  // id -> { status: 'pending'|'ok'|'flagged', note: '' }

// --- 音频控制 ---
const audio = document.getElementById('audioPlayer');
const currentTimeEl = document.getElementById('currentTime');

audio.addEventListener('timeupdate', () => {
  currentTimeEl.textContent = fmtTime(audio.currentTime);
});

document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    audio.playbackRate = parseFloat(btn.dataset.speed);
  });
});

function fmtTime(s) {
  if (isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + sec.toString().padStart(2, '0');
}

function seekTo(time) {
  audio.currentTime = Math.max(0, time);
  audio.play();
}

// --- 渲染 ---
function renderIssues(filter) {
  const container = document.getElementById('issuesList');

  let filtered = issues;
  if (filter === 'high' || filter === 'medium' || filter === 'low') {
    filtered = issues.filter(i => i.severity === filter);
  } else if (filter === 'data' || filter === 'signal' || filter === 'semantic') {
    filtered = issues.filter(i => i.layer === filter || i.layer === filter + '_ai');
  } else if (filter === 'unconfirmed') {
    filtered = issues.filter(i => !issueStates[i.id] || issueStates[i.id].status === 'pending');
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#10004;</div><h2>没有匹配的问题</h2><p>所有问题已确认或没有该类别的问题</p></div>';
    return;
  }

  container.innerHTML = filtered.map(issue => {
    const state = issueStates[issue.id] || { status: 'pending', note: '' };
    const confirmedClass = state.status !== 'pending' ? 'confirmed' : '';
    return \`
      <div class="issue-card severity-\${issue.severity} \${confirmedClass}" id="card-\${issue.id}">
        <div class="issue-header">
          <span class="badge badge-\${issue.severity}">\${issue.severity.toUpperCase()}</span>
          <span class="badge-layer">\${esc(issue.layerLabel)}</span>
          <span class="time-link" onclick="seekTo(\${issue.listenRange[0]})">\${esc(issue.timeStr)}</span>
          <span style="color:#94a3b8; font-size:12px;">\${esc(issue.type)}</span>
        </div>
        <div class="issue-detail">\${esc(issue.detail)}</div>
        \${issue.suggestion ? '<div class="issue-suggestion">' + esc(issue.suggestion) + '</div>' : ''}
        \${issue.contextBefore || issue.contextAfter ? \`
          <div class="issue-context">
            <span class="ctx-before">...\${esc(issue.contextBefore)}</span>
            <span class="ctx-marker">|</span>
            <span class="ctx-after">\${esc(issue.contextAfter)}...</span>
          </div>
        \` : ''}
        <div class="issue-actions">
          <button class="confirm-btn \${state.status === 'ok' ? 'confirmed-ok' : ''}"
            onclick="markIssue('\${issue.id}', 'ok')">&#10003; 无问题</button>
          <button class="confirm-btn \${state.status === 'flagged' ? 'flagged' : ''}"
            onclick="markIssue('\${issue.id}', 'flagged')">&#10007; 有问题</button>
          <input class="issue-note-input" placeholder="备注..."
            value="\${esc(state.note)}"
            onchange="updateNote('\${issue.id}', this.value)">
        </div>
      </div>
    \`;
  }).join('');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// --- 状态管理 ---
function markIssue(id, status) {
  if (!issueStates[id]) issueStates[id] = { status: 'pending', note: '' };
  // 点击同一按钮 = 取消
  if (issueStates[id].status === status) {
    issueStates[id].status = 'pending';
  } else {
    issueStates[id].status = status;
  }
  updateUI();
}

function updateNote(id, note) {
  if (!issueStates[id]) issueStates[id] = { status: 'pending', note: '' };
  issueStates[id].note = note;
}

function updateUI() {
  const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
  renderIssues(activeFilter);
  updateSummary();
}

function updateSummary() {
  const confirmed = Object.values(issueStates).filter(s => s.status !== 'pending').length;
  document.getElementById('actionSummary').textContent = \`已确认 \${confirmed}/\${issues.length}\`;
}

// --- 筛选 ---
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderIssues(btn.dataset.filter);
  });
});

// --- 操作 ---
function approveAll() {
  const unconfirmed = issues.filter(i => !issueStates[i.id] || issueStates[i.id].status === 'pending');
  if (unconfirmed.length > 0 && !confirm(\`还有 \${unconfirmed.length} 条未确认的问题。确定全部标记为无问题？\`)) return;
  for (const issue of issues) {
    if (!issueStates[issue.id] || issueStates[issue.id].status === 'pending') {
      issueStates[issue.id] = { status: 'ok', note: issueStates[issue.id]?.note || '' };
    }
  }
  updateUI();
  exportFeedback('approved');
}

function rejectWithIssues() {
  const flagged = Object.entries(issueStates).filter(([_, s]) => s.status === 'flagged');
  if (flagged.length === 0) {
    alert('请先标记有问题的条目（点击 "✗ 有问题" 按钮）');
    return;
  }
  exportFeedback('rejected');
}

function exportFeedback(verdict) {
  const feedback = {
    version: 'final_review_v1',
    exported_at: new Date().toISOString(),
    verdict: verdict || 'manual_export',
    audio_source: document.title,

    issues: issues.map(issue => ({
      id: issue.id,
      time: issue.time,
      timeStr: issue.timeStr,
      layer: issue.layer,
      type: issue.type,
      severity: issue.severity,
      detail: issue.detail,
      status: issueStates[issue.id]?.status || 'pending',
      note: issueStates[issue.id]?.note || ''
    })),

    summary: {
      total: issues.length,
      confirmed_ok: Object.values(issueStates).filter(s => s.status === 'ok').length,
      flagged: Object.values(issueStates).filter(s => s.status === 'flagged').length,
      pending: issues.length - Object.values(issueStates).filter(s => s.status !== 'pending').length,
      by_severity: {
        high: issues.filter(i => i.severity === 'high').length,
        medium: issues.filter(i => i.severity === 'medium').length,
        low: issues.filter(i => i.severity === 'low').length
      }
    }
  };

  const blob = new Blob([JSON.stringify(feedback, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'final_review_feedback.json';
  a.click();
  URL.revokeObjectURL(url);

  if (verdict === 'approved') {
    alert('已导出反馈。成品确认通过！');
  } else if (verdict === 'rejected') {
    alert('已导出反馈。请将文件交给 Claude 进行问题修复。');
  }
}

// --- 初始化 ---
renderIssues('all');
</script>
</body>
</html>`;
}

function getScoreClass(score) {
  if (score === '--') return '';
  const n = parseFloat(score);
  if (n >= 8) return 'score-good';
  if (n >= 6) return 'score-ok';
  return 'score-bad';
}

// --- 主逻辑 ---

function main() {
  const opts = parseArgs();

  if (!opts.audio || !opts.output) {
    console.error('用法: node generate_review_final.js --audio <file> --output <file> [--audit-report <file>] [--signal-report <file>] [--semantic-report <file>] [--qa-report <file>] [--words <file>]');
    process.exit(1);
  }

  console.log('阶段 8: 生成终审页面');
  console.log('='.repeat(50));

  // 读取输入
  const auditReport = readJsonSafe(opts.audit_report);
  const signalReport = readJsonSafe(opts.signal_report);
  const semanticReport = readJsonSafe(opts.semantic_report);
  const qaReport = readJsonSafe(opts.qa_report);
  const words = readJsonSafe(opts.words);

  console.log(`数据层报告: ${auditReport ? '已加载' : '未提供'}`);
  console.log(`信号层报告: ${signalReport ? '已加载' : '未提供'}`);
  console.log(`语义层报告: ${semanticReport ? '已加载' : '未提供'}`);
  console.log(`综合报告:   ${qaReport ? '已加载' : '未提供'}`);
  console.log(`词级时间戳: ${words ? '已加载' : '未提供'}`);

  // 合并问题
  const issues = collectIssues(auditReport, signalReport, semanticReport, qaReport, words);
  console.log(`\n合并后问题总数: ${issues.length}`);
  console.log(`  HIGH: ${issues.filter(i => i.severity === 'high').length}`);
  console.log(`  MEDIUM: ${issues.filter(i => i.severity === 'medium').length}`);
  console.log(`  LOW: ${issues.filter(i => i.severity === 'low').length}`);

  // 生成 HTML
  const html = generateHtml(issues, opts.audio, qaReport, auditReport, semanticReport);

  fs.writeFileSync(opts.output, html, 'utf8');
  console.log(`\n终审页面已生成: ${opts.output}`);

  if (issues.length === 0) {
    console.log('\n没有质检问题。可直接确认通过。');
  }
}

main();

#!/usr/bin/env node
/**
 * Phase C: 语义层质检 — semantic_review.js
 *
 * 对剪辑后音频的重转录结果与预期文本做词级 LCS 对齐，
 * 检测残留填充词、残留卡顿、语义断裂、内容缺失。
 *
 * 用法:
 *   node semantic_review.js \
 *     --new-words <new_subtitles_words.json> \
 *     --original-words <original_subtitles_words.json> \
 *     --delete-segments <delete_segments_edited.json> \
 *     --sentences <sentences.txt> \
 *     --output <qa_semantic_report.json>
 *
 * 输入:
 *   - new_subtitles_words.json:  剪辑后音频的重转录结果（字级时间戳）
 *   - original_subtitles_words.json: 原始音频的转录（字级时间戳）
 *   - delete_segments_edited.json: 最终删除段列表
 *   - sentences.txt: 原始句子分割
 *
 * 输出:
 *   qa_semantic_report.json
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

// --- 常量 ---

const FILLER_PATTERNS = /^(嗯|啊|呃|那个|对|就是|然后|所以说|对对对)$/;
const STUTTER_MIN_LENGTH = 1;  // 最少重复字数

// --- 核心函数 ---

/**
 * 从原始转录中计算"预期保留文本"：原文 - 删除段
 */
function computeExpectedText(originalWords, deleteSegments) {
  const kept = [];
  for (const word of originalWords) {
    const isDeleted = deleteSegments.some(seg =>
      word.start >= seg.start - 0.01 && word.end <= seg.end + 0.01
    );
    if (!isDeleted) {
      kept.push(word);
    }
  }
  return kept;
}

/**
 * 词级 LCS 对齐
 * 返回: { matched, onlyInExpected, onlyInActual }
 */
function wordLevelLCS(expected, actual) {
  const expTexts = expected.map(w => w.text || w.word);
  const actTexts = actual.map(w => w.text || w.word);

  const m = expTexts.length;
  const n = actTexts.length;

  // LCS DP
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (expTexts[i - 1] === actTexts[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯
  const matched = [];
  const onlyInExpected = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (expTexts[i - 1] === actTexts[j - 1]) {
      matched.unshift({ expected: expected[i - 1], actual: actual[j - 1] });
      i--; j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      onlyInExpected.unshift(expected[i - 1]);
      i--;
    } else {
      j--;
    }
  }
  while (i > 0) {
    onlyInExpected.unshift(expected[i - 1]);
    i--;
  }

  const onlyInActual = [];
  // 简化：actual 中未匹配的词
  const matchedActualIndices = new Set(matched.map((_, idx) => idx));
  // TODO: 更精确的 actual-only 提取

  return { matched, onlyInExpected, onlyInActual };
}

/**
 * C1: 残留填充词检测
 */
function checkResidualFillers(newWords) {
  const issues = [];
  for (const word of newWords) {
    const text = (word.text || word.word || '').trim();
    if (FILLER_PATTERNS.test(text)) {
      issues.push({
        time: word.start,
        text,
        context: `...${text}...`
      });
    }
  }
  return issues;
}

/**
 * C2: 残留卡顿检测（相邻重复词）
 */
function checkResidualStutters(newWords) {
  const issues = [];
  for (let i = 1; i < newWords.length; i++) {
    const prev = (newWords[i - 1].text || newWords[i - 1].word || '').trim();
    const curr = (newWords[i].text || newWords[i].word || '').trim();
    if (prev.length >= STUTTER_MIN_LENGTH && prev === curr) {
      // 间隔小于 0.5s 才算卡顿
      if (newWords[i].start - newWords[i - 1].end < 0.5) {
        issues.push({
          time: newWords[i - 1].start,
          text: `${prev}${curr}`,
          context: `重复: "${prev}" × 2`
        });
      }
    }
  }
  return issues;
}

/**
 * C4: 内容缺失检测（LCS 中预期存在但实际缺失的连续片段）
 */
function checkMissingContent(onlyInExpected) {
  const issues = [];
  if (onlyInExpected.length === 0) return issues;

  // 合并连续缺失词为片段
  let currentGroup = [onlyInExpected[0]];
  for (let i = 1; i < onlyInExpected.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    const curr = onlyInExpected[i];
    if (curr.start - prev.end < 1.0) {
      currentGroup.push(curr);
    } else {
      if (currentGroup.length >= 3) {
        const text = currentGroup.map(w => w.text || w.word).join('');
        issues.push({
          expected: text,
          time_range: [currentGroup[0].start, currentGroup[currentGroup.length - 1].end]
        });
      }
      currentGroup = [curr];
    }
  }
  if (currentGroup.length >= 3) {
    const text = currentGroup.map(w => w.text || w.word).join('');
    issues.push({
      expected: text,
      time_range: [currentGroup[0].start, currentGroup[currentGroup.length - 1].end]
    });
  }

  return issues;
}

// --- 主逻辑 ---

function main() {
  const opts = parseArgs();

  if (!opts.new_words || !opts.original_words || !opts.delete_segments || !opts.output) {
    console.error('用法: node semantic_review.js --new-words <file> --original-words <file> --delete-segments <file> --sentences <file> --output <file>');
    process.exit(1);
  }

  console.log('Phase C: 语义层质检');
  console.log('='.repeat(50));

  // 读取输入
  const newWords = JSON.parse(fs.readFileSync(opts.new_words, 'utf8'));
  const originalWords = JSON.parse(fs.readFileSync(opts.original_words, 'utf8'));
  const deleteSegments = JSON.parse(fs.readFileSync(opts.delete_segments, 'utf8'));

  // 提取词数组（兼容不同格式）
  const newWordList = Array.isArray(newWords) ? newWords :
    (newWords.words || newWords.subtitles?.flatMap(s => s.words) || []);
  const originalWordList = Array.isArray(originalWords) ? originalWords :
    (originalWords.words || originalWords.subtitles?.flatMap(s => s.words) || []);
  const segmentList = Array.isArray(deleteSegments) ? deleteSegments :
    (deleteSegments.segments || []);

  // 计算预期保留文本
  console.log(`原始词数: ${originalWordList.length}`);
  console.log(`删除段数: ${segmentList.length}`);
  const expectedKept = computeExpectedText(originalWordList, segmentList);
  console.log(`预期保留词数: ${expectedKept.length}`);
  console.log(`重转录词数: ${newWordList.length}`);

  // C1: 残留填充词
  const residualFillers = checkResidualFillers(newWordList);
  console.log(`\nC1 残留填充词: ${residualFillers.length} 个`);

  // C2: 残留卡顿
  const residualStutters = checkResidualStutters(newWordList);
  console.log(`C2 残留卡顿: ${residualStutters.length} 个`);

  // C3: 语义断裂 — 需要 Claude 评估，这里只标记切点位置
  // （由调用方的 Claude 实例读取 report 后评估）
  console.log(`C3 语义断裂: 需 Claude 评估切点上下文`);

  // LCS 对齐
  const { matched, onlyInExpected } = wordLevelLCS(expectedKept, newWordList);
  console.log(`\nLCS 匹配词数: ${matched.length}`);
  console.log(`预期中缺失词数: ${onlyInExpected.length}`);

  // C4: 内容缺失
  const missingContent = checkMissingContent(onlyInExpected);
  console.log(`C4 内容缺失片段: ${missingContent.length} 个`);

  // 生成报告
  const report = {
    phase: 'C',
    timestamp: new Date().toISOString(),
    stats: {
      original_words: originalWordList.length,
      expected_kept: expectedKept.length,
      actual_words: newWordList.length,
      lcs_matched: matched.length,
      lcs_missing: onlyInExpected.length
    },
    checks: {
      residual_fillers: residualFillers,
      residual_stutters: residualStutters,
      semantic_breaks: [], // 由 Claude 填充
      missing_content: missingContent
    },
    summary: {
      total_issues: residualFillers.length + residualStutters.length + missingContent.length,
      by_severity: {
        HIGH: missingContent.filter(m => m.expected.length > 10).length,
        MEDIUM: residualFillers.length + residualStutters.length,
        LOW: missingContent.filter(m => m.expected.length <= 10).length
      },
      note: 'C3 语义断裂需要 Claude 读取切点上下文后评估，不在此脚本中自动检测'
    }
  };

  fs.writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n报告已写入: ${opts.output}`);
  console.log(`总问题数: ${report.summary.total_issues} (HIGH: ${report.summary.by_severity.HIGH}, MEDIUM: ${report.summary.by_severity.MEDIUM})`);
}

main();

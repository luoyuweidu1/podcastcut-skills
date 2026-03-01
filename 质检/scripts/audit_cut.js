#!/usr/bin/env node
/**
 * audit_cut.js — 剪辑质检脚本
 *
 * 在剪辑完成后自动审查 delete_segments，发现以下问题：
 *   1. 恢复句完整性：恢复的句子是否被任何 delete segment 覆盖
 *   2. 用户手动删除生效性：用户标记的删除是否都有对应 segment
 *   3. 切点静音检测：相邻切点之间是否有可能产生听感停顿的静音
 *   4. 大段删除衔接：>5s 的删除前后文本是否自然衔接
 *
 * 用法:
 *   node audit_cut.js <output_dir>
 *
 * 例:
 *   node audit_cut.js output/2026-02-27_meeting_02
 *
 * 输入文件 (自动在 output_dir 下查找):
 *   - 2_分析/delete_segments_edited.json (或 delete_segments.json)
 *   - 2_分析/fine_analysis.json
 *   - 2_分析/sentences.txt
 *   - 1_转录/subtitles_words.json
 *   - ai_feedback (可选，如有 restore/correction 信息)
 *
 * 输出:
 *   - 2_分析/audit_report.json — 机器可读的完整报告
 *   - stdout — 人类可读的摘要
 */

const fs = require('fs');
const path = require('path');

// --- 参数解析 ---
const outputDir = process.argv[2];
if (!outputDir) {
  console.error('用法: node audit_cut.js <output_dir>');
  process.exit(1);
}

const analysisDir = path.join(outputDir, '2_分析');
const transcriptDir = path.join(outputDir, '1_转录');

// --- 加载数据 ---
function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function loadSegments() {
  let data = loadJSON(path.join(analysisDir, 'delete_segments_edited.json'))
    || loadJSON(path.join(analysisDir, 'delete_segments.json'));
  if (!data) { console.error('找不到 delete_segments 文件'); process.exit(1); }
  return Array.isArray(data) ? data : (data.segments || data.delete_segments || []);
}

function loadWords() {
  const data = loadJSON(path.join(transcriptDir, 'subtitles_words.json'));
  if (!data) { console.error('找不到 subtitles_words.json'); process.exit(1); }
  return Array.isArray(data) ? data : (data.words || []);
}

function loadSentences() {
  const txt = fs.readFileSync(path.join(analysisDir, 'sentences.txt'), 'utf8').trim();
  return txt.split('\n').map(line => {
    const parts = line.split('|');
    const range = parts[1].split('-');
    return {
      idx: parseInt(parts[0]),
      wordStart: parseInt(range[0]),
      wordEnd: parseInt(range[1]),
      speaker: parts[2],
      text: parts[3]
    };
  });
}

function loadFeedback() {
  // 尝试多种可能的反馈文件路径
  const candidates = [
    ...fs.readdirSync(analysisDir).filter(f => f.startsWith('ai_feedback')).map(f => path.join(analysisDir, f)),
    // 也检查上传目录
  ];
  for (const fp of candidates) {
    const data = loadJSON(fp);
    if (data && (data.restore_feedback || data.user_corrections)) return data;
  }
  return null;
}

const segments = loadSegments();
const words = loadWords();
const sentences = loadSentences();
const fineAnalysis = loadJSON(path.join(analysisDir, 'fine_analysis.json'));
const edits = fineAnalysis ? (fineAnalysis.edits || []) : [];
const feedback = loadFeedback();
const corrections = loadJSON(path.join(analysisDir, 'segment_corrections.json'));

// --- 辅助函数 ---
function wordTime(wordIdx) {
  const w = words[wordIdx];
  if (!w) return { start: 0, end: 0 };
  return { start: w.start || w.s || 0, end: w.end || w.e || 0 };
}

function sentenceTimeRange(sent) {
  const start = wordTime(sent.wordStart);
  const end = wordTime(sent.wordEnd);
  return { start: start.start, end: end.end };
}

function segmentsOverlapping(start, end) {
  return segments.filter(s => s.start < end && s.end > start);
}

function wordsInRange(startTime, endTime) {
  return words.filter(w => {
    const ws = w.start || w.s || 0;
    const we = w.end || w.e || 0;
    return ws >= startTime && we <= endTime;
  }).map(w => w.text || w.word || w.w || '');
}

// --- 检查 1: 恢复句完整性 ---
//
// 核心逻辑：恢复句 = 用户想保留的句子，但句子内的 fine edit（如口吃、填充词删除）
// 仍然是有意保留的。所以只需要检查：
//   a) 被"非本句 fine edit"的 segment 覆盖（跨句误伤）
//   b) 被"非 fine edit 来源"的 segment 覆盖（如旧 HTML 导出的 wholeSentence segment）
//
// 不应报告的情况：
//   - segment 对应本句的 fine_analysis edit（用户想删口吃但保留句子整体）
//
function checkRestoredSentences() {
  const issues = [];

  // 获取恢复句列表
  let restoredIndices = [];
  if (corrections && corrections.all_restored_sentence_indices) {
    restoredIndices = corrections.all_restored_sentence_indices;
  } else if (feedback && feedback.restore_feedback) {
    restoredIndices = [...new Set(feedback.restore_feedback.map(r => r.sentenceIdx))];
  }

  if (restoredIndices.length === 0) return { issues, restoredCount: 0 };

  // 预处理：为每个恢复句收集其 fine_analysis edits 的时间范围
  // 这些是用户有意保留的删除（口吃、填充词等）
  const editRangesBySentence = {};
  for (const sIdx of restoredIndices) {
    editRangesBySentence[sIdx] = edits
      .filter(e => e.sentenceIdx === sIdx && e.deleteStart !== undefined)
      .map(e => ({ start: e.deleteStart, end: e.deleteEnd, type: e.type }));
  }

  // 判断一个 segment 是否对应本句的某个 fine edit
  // 使用宽松匹配：segment 的大部分时间范围（>70%）落在某个 edit 范围内
  function isIntentionalEdit(seg, sentIdx) {
    const sentEdits = editRangesBySentence[sentIdx] || [];
    for (const edit of sentEdits) {
      const overlapStart = Math.max(seg.start, edit.start);
      const overlapEnd = Math.min(seg.end, edit.end);
      if (overlapEnd > overlapStart) {
        const overlapDuration = overlapEnd - overlapStart;
        const segDuration = seg.end - seg.start;
        // segment 与 edit 有显著重叠 → 认为是有意的 fine edit
        if (overlapDuration / segDuration > 0.5 || overlapDuration > 0.3) {
          return true;
        }
      }
    }
    // 也检查其他句子的 edit 是否解释这个 segment（跨句 fine edit 也是有意的）
    for (const edit of edits) {
      if (edit.deleteStart === undefined) continue;
      const overlapStart = Math.max(seg.start, edit.deleteStart);
      const overlapEnd = Math.min(seg.end, edit.deleteEnd);
      if (overlapEnd > overlapStart) {
        const overlapDuration = overlapEnd - overlapStart;
        const segDuration = seg.end - seg.start;
        if (overlapDuration / segDuration > 0.5 || overlapDuration > 0.3) {
          return true;
        }
      }
    }
    return false;
  }

  for (const sIdx of restoredIndices) {
    const sent = sentences[sIdx];
    if (!sent) continue;

    // 收集覆盖本句 word range 的所有 segment
    const coveredSegments = new Map(); // seg key → { seg, words: [] }
    for (let wi = sent.wordStart; wi <= sent.wordEnd; wi++) {
      const wt = wordTime(wi);
      const overlaps = segmentsOverlapping(wt.start, wt.end);
      for (const seg of overlaps) {
        const key = `${Math.round(seg.start * 100)}_${Math.round(seg.end * 100)}`;
        if (!coveredSegments.has(key)) {
          coveredSegments.set(key, { seg, words: [] });
        }
        const wordText = words[wi].text || words[wi].word || words[wi].w || '';
        coveredSegments.get(key).words.push({ idx: wi, text: wordText, time: wt });
      }
    }

    // 对每个覆盖 segment，判断是否是有意的 fine edit
    for (const [key, { seg, words: coveredWords }] of coveredSegments) {
      if (isIntentionalEdit(seg, sIdx)) {
        continue; // 有意的 fine edit，跳过
      }

      // 非预期的覆盖 → 报告问题
      const wordTexts = coveredWords.map(w => w.text).join('');
      issues.push({
        type: 'restored_word_covered',
        sentenceIdx: sIdx,
        wordTexts,
        wordCount: coveredWords.length,
        coveringSegment: [seg.start, seg.end],
        segmentDuration: parseFloat((seg.end - seg.start).toFixed(2)),
        sentenceText: sent.text.substring(0, 60),
        note: '此 segment 不对应任何 fine_analysis edit，可能是跨句误伤或旧 HTML 导出 bug'
      });
    }
  }

  return { issues, restoredCount: restoredIndices.length };
}

// --- 检查 2: 用户手动删除生效性 ---
//
// 检查 user_corrections.added_deletions（用户确认的整句删除）是否都有 segment 覆盖。
// missed_catches 是 AI 建议的遗漏项，只有当它带 timestamp 时才检查（通常不带）。
// 注意：这里只检查"是否有任何 segment 与句子范围重叠"，不要求完全覆盖。
// 因为整句删除可能分拆成多个 fine edit segments。
//
function checkManualDeletions() {
  const issues = [];

  if (!feedback) return { issues, checkedCount: 0 };

  // 2a: 检查 user_corrections.added_deletions (整句删除)
  const addedSentences = [...new Set(feedback.user_corrections?.added_deletions || [])];
  for (const sIdx of addedSentences) {
    const sent = sentences[sIdx];
    if (!sent) continue;
    const range = sentenceTimeRange(sent);

    // 检查整个句子的时间范围是否有 segment 覆盖
    const overlap = segmentsOverlapping(range.start, range.end);
    if (overlap.length === 0) {
      issues.push({
        type: 'manual_sentence_not_deleted',
        sentenceIdx: sIdx,
        timeRange: [range.start, range.end],
        sentenceText: sent.text.substring(0, 60)
      });
    }
  }

  // 2b: 检查 missed_catches (AI 建议的遗漏)
  // 只检查带精确时间戳的条目；没有时间戳的跳过
  const missedCatches = feedback.missed_catches || [];
  let missedWithTs = 0;
  for (const mc of missedCatches) {
    if (!mc.timestamp || mc.timestamp.start === undefined) continue;
    missedWithTs++;
    const overlap = segmentsOverlapping(mc.timestamp.start, mc.timestamp.end);
    if (overlap.length === 0) {
      issues.push({
        type: 'missed_catch_not_covered',
        sentenceIdx: mc.sentenceIdx,
        timeRange: [mc.timestamp.start, mc.timestamp.end],
        text: (mc.selectedText || '').substring(0, 40),
        category: mc.typeLabel || mc.type
      });
    }
  }

  return { issues, checkedCount: addedSentences.length + missedWithTs };
}

// --- 检查 3: 切点静音检测 ---
function checkCutPointSilences() {
  const issues = [];
  const SILENCE_THRESHOLD = 0.3; // 秒，超过此值标记为可疑停顿

  // 按起始时间排序所有 segment
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sorted.length - 1; i++) {
    const segEnd = sorted[i].end;
    const nextSegStart = sorted[i + 1].start;
    const gapDuration = nextSegStart - segEnd;

    // 只关注短间距保留段 (gap < 3s 的才检查，太长的是正常内容)
    if (gapDuration <= 0 || gapDuration > 3.0) continue;

    // 检查这段保留区间内是否有实际语音内容
    const gapWords = words.filter(w => {
      const ws = w.start || w.s || 0;
      const we = w.end || w.e || 0;
      return ws >= segEnd && we <= nextSegStart;
    });

    const hasContent = gapWords.some(w => {
      const text = (w.text || w.word || w.w || '').replace(/[，。！？、：；""''（）\s]/g, '');
      return text.length > 0;
    });

    if (!hasContent && gapDuration > SILENCE_THRESHOLD) {
      // 找到前后的实际语音内容
      const beforeWords = words.filter(w => {
        const we = w.end || w.e || 0;
        return we <= segEnd && we > segEnd - 2;
      });
      const afterWords = words.filter(w => {
        const ws = w.start || w.s || 0;
        return ws >= nextSegStart && ws < nextSegStart + 2;
      });
      const beforeText = beforeWords.slice(-3).map(w => w.text || w.word || w.w || '').join('');
      const afterText = afterWords.slice(0, 3).map(w => w.text || w.word || w.w || '').join('');

      issues.push({
        type: 'silence_gap',
        gapStart: segEnd,
        gapEnd: nextSegStart,
        duration: parseFloat(gapDuration.toFixed(3)),
        beforeText,
        afterText,
        suggestion: `可扩展删除段 [${segEnd.toFixed(2)}-${nextSegStart.toFixed(2)}] 消除停顿`
      });
    }
  }

  return { issues };
}

// --- 检查 4: 大段删除衔接 ---
function checkLargeDeletions() {
  const issues = [];
  const LARGE_THRESHOLD = 5.0; // 秒

  const sorted = [...segments].sort((a, b) => a.start - b.start);

  for (const seg of sorted) {
    const duration = seg.end - seg.start;
    if (duration < LARGE_THRESHOLD) continue;

    // 找删除前后的文本
    const beforeWords = words.filter(w => {
      const we = w.end || w.e || 0;
      return we <= seg.start && we > seg.start - 5;
    });
    const afterWords = words.filter(w => {
      const ws = w.start || w.s || 0;
      return ws >= seg.end && ws < seg.end + 5;
    });

    const beforeText = beforeWords.slice(-8).map(w => w.text || w.word || w.w || '').join('');
    const afterText = afterWords.slice(0, 8).map(w => w.text || w.word || w.w || '').join('');

    // 检查说话人切换
    const beforeSpeaker = beforeWords.length > 0 ? null : null; // 简化：暂不做说话人检查

    issues.push({
      type: 'large_deletion',
      start: seg.start,
      end: seg.end,
      duration: parseFloat(duration.toFixed(1)),
      beforeText,
      afterText,
      needsReview: true
    });
  }

  return { issues };
}

// --- 主函数 ---
function main() {
  console.log('🔍 剪辑质检开始...\n');

  const report = {
    timestamp: new Date().toISOString(),
    outputDir,
    totalSegments: segments.length,
    checks: {}
  };

  // 检查 1
  const restored = checkRestoredSentences();
  report.checks.restoredSentences = restored;
  console.log(`✅ 检查1: 恢复句完整性 — ${restored.restoredCount} 个恢复句，${restored.issues.length} 个问题`);
  if (restored.issues.length > 0) {
    restored.issues.forEach(i => {
      console.log(`   ⚠️  s${i.sentenceIdx} 的 "${i.wordTexts}" (${i.wordCount}词, ${i.segmentDuration}s) 被 segment [${i.coveringSegment[0].toFixed(2)}-${i.coveringSegment[1].toFixed(2)}] 覆盖`);
    });
  }

  // 检查 2
  const manual = checkManualDeletions();
  report.checks.manualDeletions = manual;
  console.log(`\n✅ 检查2: 用户手动删除 — ${manual.checkedCount} 项检查，${manual.issues.length} 个问题`);
  if (manual.issues.length > 0) {
    manual.issues.slice(0, 10).forEach(i => {
      if (i.type === 'manual_sentence_not_deleted') {
        console.log(`   ⚠️  s${i.sentenceIdx} 整句删除未生效 [${i.timeRange[0].toFixed(2)}-${i.timeRange[1].toFixed(2)}]`);
      } else {
        console.log(`   ⚠️  s${i.sentenceIdx} "${i.text}" (${i.category}) 未被覆盖`);
      }
    });
    if (manual.issues.length > 10) console.log(`   ... 还有 ${manual.issues.length - 10} 个`);
  }

  // 检查 3
  const silences = checkCutPointSilences();
  report.checks.cutPointSilences = silences;
  console.log(`\n✅ 检查3: 切点静音 — ${silences.issues.length} 个可疑停顿`);
  if (silences.issues.length > 0) {
    silences.issues.slice(0, 10).forEach(i => {
      console.log(`   ⏸️  [${i.gapStart.toFixed(2)}-${i.gapEnd.toFixed(2)}] ${i.duration}s 静音 — "${i.beforeText}" → "${i.afterText}"`);
    });
    if (silences.issues.length > 10) console.log(`   ... 还有 ${silences.issues.length - 10} 个`);
  }

  // 检查 4
  const large = checkLargeDeletions();
  report.checks.largeDeletions = large;
  console.log(`\n✅ 检查4: 大段删除 — ${large.issues.length} 段 (>5s) 需人工确认衔接`);
  if (large.issues.length > 0) {
    large.issues.forEach(i => {
      console.log(`   ✂️  [${i.start.toFixed(1)}-${i.end.toFixed(1)}s] ${i.duration}s — "...${i.beforeText}" → "${i.afterText}..."`);
    });
  }

  // 汇总
  const totalIssues = restored.issues.length + manual.issues.length + silences.issues.length;
  console.log(`\n${'─'.repeat(50)}`);
  if (totalIssues === 0) {
    console.log('🎉 质检通过！未发现自动可检测的问题。');
    console.log(`   (${large.issues.length} 段大段删除建议人工确认衔接)`);
  } else {
    console.log(`⚠️  发现 ${totalIssues} 个问题需要修复：`);
    if (restored.issues.length) console.log(`   - ${restored.issues.length} 个恢复句被覆盖`);
    if (manual.issues.length) console.log(`   - ${manual.issues.length} 个手动删除未生效`);
    if (silences.issues.length) console.log(`   - ${silences.issues.length} 个切点静音停顿`);
    console.log(`   + ${large.issues.length} 段大段删除建议人工确认`);
  }

  // 保存报告
  const reportPath = path.join(analysisDir, 'audit_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 完整报告: ${reportPath}`);

  // 退出码：有问题返回 1
  process.exit(totalIssues > 0 ? 1 : 0);
}

main();

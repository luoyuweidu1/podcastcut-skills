#!/usr/bin/env node
/**
 * auto_fix.js — 根据 audit_report.json 自动修复 delete_segments
 *
 * 处理：
 *   1. restored_word_covered → 移除覆盖恢复句的 segment（仅非 fine edit 的异常覆盖）
 *   2. silence_gap → 扩展相邻 segment 以消除静音停顿
 *
 * 不自动处理（需人工）：
 *   - manual_sentence_not_deleted → 需要知道精确删除范围
 *   - missed_catch_not_covered → 同上
 *   - large_deletion → 仅衔接审查
 *
 * 用法:
 *   node auto_fix.js <output_dir> [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const outputDir = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!outputDir) {
  console.error('用法: node auto_fix.js <output_dir> [--dry-run]');
  process.exit(1);
}

const analysisDir = path.join(outputDir, '2_分析');
const reportPath = path.join(analysisDir, 'audit_report.json');
const segPath = path.join(analysisDir, 'delete_segments_edited.json');
const segFallback = path.join(analysisDir, 'delete_segments.json');

if (!fs.existsSync(reportPath)) {
  console.error('请先运行 audit_cut.js 生成 audit_report.json');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const segFile = fs.existsSync(segPath) ? segPath : segFallback;
const segData = JSON.parse(fs.readFileSync(segFile, 'utf8'));
let segs = Array.isArray(segData) ? segData : (segData.segments || segData.delete_segments || []);

const originalCount = segs.length;
let removedCount = 0;
let addedCount = 0;
let modifiedCount = 0;

// --- Fix 1: 移除覆盖恢复句的 segment ---
const restoredIssues = report.checks.restoredSentences?.issues || [];
if (restoredIssues.length > 0) {
  console.log(`🔧 修复恢复句覆盖: ${restoredIssues.length} 个问题`);

  // 收集所有需要移除的 segment 范围
  const toRemove = new Set();
  for (const issue of restoredIssues) {
    const [segStart, segEnd] = issue.coveringSegment;
    const key = Math.round(segStart * 100) + '_' + Math.round(segEnd * 100);
    toRemove.add(key);
  }

  const before = segs.length;
  segs = segs.filter(s => {
    const key = Math.round(s.start * 100) + '_' + Math.round(s.end * 100);
    return !toRemove.has(key);
  });
  removedCount += before - segs.length;
  console.log(`   移除 ${before - segs.length} 个 segment`);
}

// --- Fix 2: 消除切点静音停顿 ---
const silenceIssues = report.checks.cutPointSilences?.issues || [];
if (silenceIssues.length > 0) {
  console.log(`🔧 修复切点静音: ${silenceIssues.length} 个停顿`);

  for (const issue of silenceIssues) {
    // 策略：找到 gap 前的 segment，扩展其 end 到 gap 结束
    const prevSeg = segs.find(s => Math.abs(s.end - issue.gapStart) < 0.05);
    const nextSeg = segs.find(s => Math.abs(s.start - issue.gapEnd) < 0.05);

    if (prevSeg) {
      // 扩展前一个 segment 的结束时间
      prevSeg.end = issue.gapEnd;
      modifiedCount++;
      console.log(`   扩展 [${issue.gapStart.toFixed(2)}] → [${issue.gapEnd.toFixed(2)}] (消除 ${issue.duration}s 停顿)`);
    } else if (nextSeg) {
      // 扩展后一个 segment 的开始时间
      nextSeg.start = issue.gapStart;
      modifiedCount++;
      console.log(`   扩展 [${issue.gapStart.toFixed(2)} ←] (消除 ${issue.duration}s 停顿)`);
    } else {
      // 新增一个 segment 覆盖这段静音
      segs.push({ start: issue.gapStart, end: issue.gapEnd, text: '(auto-fix silence gap)' });
      addedCount++;
      console.log(`   新增 [${issue.gapStart.toFixed(2)}-${issue.gapEnd.toFixed(2)}] (消除 ${issue.duration}s 停顿)`);
    }
  }

  segs.sort((a, b) => a.start - b.start);
}

// --- 汇总 ---
console.log(`\n${'─'.repeat(40)}`);
console.log(`原始 segment 数: ${originalCount}`);
console.log(`移除: ${removedCount}, 新增: ${addedCount}, 修改: ${modifiedCount}`);
console.log(`最终 segment 数: ${segs.length}`);

// 未能自动修复的问题
const manualIssues = report.checks.manualDeletions?.issues || [];
if (manualIssues.length > 0) {
  console.log(`\n⚠️  ${manualIssues.length} 个手动删除问题需要人工处理`);
}

if (dryRun) {
  console.log('\n[dry-run] 未写入文件');
} else {
  // 备份原文件
  const backupPath = segFile.replace('.json', '_backup.json');
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(segFile, backupPath);
    console.log(`\n💾 备份: ${backupPath}`);
  }

  // 写入修复后的文件
  if (Array.isArray(segData)) {
    fs.writeFileSync(segFile, JSON.stringify(segs, null, 2));
  } else {
    const key = segData.segments ? 'segments' : 'delete_segments';
    segData[key] = segs;
    fs.writeFileSync(segFile, JSON.stringify(segData, null, 2));
  }
  console.log(`✅ 已保存: ${segFile}`);
}

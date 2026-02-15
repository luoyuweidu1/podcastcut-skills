#!/usr/bin/env node
/**
 * 步骤8b: 将句子级删除标记转换为时间段格式
 *
 * 用法: node convert_to_segments.js [selected.json] [sentences.txt] [subtitles_words.json]
 * 输出: delete_segments.json
 */

const fs = require('fs');
const path = require('path');

const selectedFile = process.argv[2] || 'selected_default.json';
const sentencesFile = process.argv[3] || 'sentences.txt';
const wordsFile = process.argv[4] || '../1_转录/subtitles_words.json';

// 检查文件
if (!fs.existsSync(selectedFile)) {
  console.error(`❌ 找不到文件: ${selectedFile}`);
  process.exit(1);
}

if (!fs.existsSync(sentencesFile)) {
  console.error(`❌ 找不到文件: ${sentencesFile}`);
  process.exit(1);
}

if (!fs.existsSync(wordsFile)) {
  console.error(`❌ 找不到文件: ${wordsFile}`);
  process.exit(1);
}

const selected = JSON.parse(fs.readFileSync(selectedFile, 'utf8'));
const sentences = fs.readFileSync(sentencesFile, 'utf8').split('\n').filter(l => l.trim());
const words = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));

// 获取要删除的句子索引
const deleteIndices = Object.keys(selected).filter(k => selected[k]).map(Number).sort((a, b) => a - b);

console.log(`📝 处理 ${deleteIndices.length} 个待删除句子...`);

// 辅助函数：获取句子的时间范围
function getSentenceTime(idx) {
  const line = sentences[idx];
  if (!line) return null;

  const parts = line.split('|');
  if (parts.length < 4) return null;

  const wordRange = parts[1];
  const [startIdx, endIdx] = wordRange.split('-').map(Number);

  let wordCount = 0;
  let startTime = null, endTime = null;

  for (let w of words) {
    if (w.isGap || w.isSpeakerLabel) continue;

    if (wordCount === startIdx) startTime = w.start;
    if (wordCount === endIdx) {
      endTime = w.end;
      break;
    }
    wordCount++;
  }

  if (startTime !== null && endTime !== null) {
    return { start: startTime, end: endTime };
  }
  return null;
}

// 将连续的删除句子分组（如 [0,1,2,...,19], [35,36], [49,50,...,152]）
// 每组生成一个完整的删除段，覆盖句子间的所有间隙
const groups = [];
let groupStart = null;
let groupEnd = null;

for (let i = 0; i < deleteIndices.length; i++) {
  const idx = deleteIndices[i];
  const nextIdx = deleteIndices[i + 1];

  if (groupStart === null) groupStart = idx;
  groupEnd = idx;

  // 如果下一个索引不连续，结束当前组
  if (nextIdx === undefined || nextIdx !== idx + 1) {
    const startTime = getSentenceTime(groupStart);
    const endTime = getSentenceTime(groupEnd);
    if (startTime && endTime) {
      groups.push({ start: startTime.start, end: endTime.end });
    }
    groupStart = null;
    groupEnd = null;
  }
}

console.log(`   连续删除组: ${groups.length}`);

// 合并相邻组（间隔小于1秒，处理非连续但时间接近的情况）
groups.sort((a, b) => a.start - b.start);
const merged = [];
let current = null;

groups.forEach(seg => {
  if (!current) {
    current = { ...seg };
  } else if (seg.start - current.end < 1.0) {
    current.end = Math.max(current.end, seg.end);
  } else {
    merged.push(current);
    current = { ...seg };
  }
});
if (current) merged.push(current);

fs.writeFileSync('delete_segments.json', JSON.stringify(merged, null, 2));

console.log(`✅ 已生成 delete_segments.json`);
console.log(`   连续组: ${groups.length}`);
console.log(`   合并后: ${merged.length}`);

// 计算删除时长
const totalDeleteTime = merged.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
const minutes = Math.floor(totalDeleteTime / 60);
const seconds = Math.floor(totalDeleteTime % 60);
console.log(`   删除时长: ${minutes}分${seconds}秒`);

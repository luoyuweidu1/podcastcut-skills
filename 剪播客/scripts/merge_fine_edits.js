#!/usr/bin/env node
/**
 * 合并精剪编辑（5b）到 delete_segments.json
 *
 * 读取 fine_analysis.json 中的词级编辑，转换为时间段，
 * 与现有 delete_segments.json（5a句子级）合并
 *
 * 用法: node merge_fine_edits.js [fine_analysis.json] [sentences.txt] [subtitles_words.json] [delete_segments.json]
 */

const fs = require('fs');

const fineFile = process.argv[2] || 'fine_analysis.json';
const sentencesFile = process.argv[3] || 'sentences.txt';
const wordsFile = process.argv[4] || '../1_转录/subtitles_words.json';
const segmentsFile = process.argv[5] || 'delete_segments.json';

// 检查文件
for (const [f, name] of [[fineFile, '精剪分析'], [sentencesFile, '句子'], [wordsFile, '词'], [segmentsFile, '删除片段']]) {
  if (!fs.existsSync(f)) {
    console.error(`❌ 找不到${name}文件: ${f}`);
    process.exit(1);
  }
}

const fineAnalysis = JSON.parse(fs.readFileSync(fineFile, 'utf8'));
const sentences = fs.readFileSync(sentencesFile, 'utf8').split('\n').filter(l => l.trim());
const allWords = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
const existingSegments = JSON.parse(fs.readFileSync(segmentsFile, 'utf8'));

// 构建实际词索引（跳过 gap 和 speaker label）
const actualWords = allWords.filter(w => !w.isGap && !w.isSpeakerLabel);

function getWordsForSentence(sentenceIdx) {
  const line = sentences[sentenceIdx];
  if (!line) return null;
  const parts = line.split('|');
  if (parts.length < 4) return null;
  const [startIdx, endIdx] = parts[1].split('-').map(Number);
  return { startIdx, endIdx, words: actualWords.slice(startIdx, endIdx + 1) };
}

const fineSegments = [];
let skipped = 0;

for (const edit of fineAnalysis.edits) {
  const { sentenceIdx, type, deleteText } = edit;
  const sentenceData = getWordsForSentence(sentenceIdx);
  if (!sentenceData) { skipped++; continue; }

  const { words } = sentenceData;

  if (type === 'silence') {
    // 直接使用 fine_analysis 里的精确时间（gap 在句子边界外，不能在句内词间找）
    // 保留 0.8s 自然停顿，只删除超出部分
    const silStart = edit.deleteStart;
    const silEnd = edit.deleteEnd;
    if (silStart !== undefined && silEnd !== undefined) {
      const keepDur = 0.8;  // 保留的自然停顿
      const actualStart = silStart + keepDur;
      if (actualStart < silEnd) {
        fineSegments.push({ start: actualStart, end: silEnd });
      }
    }
  } else if (type === 'residual_sentence' || type === 'repeated_sentence') {
    // 整句删除
    if (words.length > 0) {
      fineSegments.push({ start: words[0].start, end: words[words.length - 1].end });
    }
  } else {
    // 文本匹配型：stutter, self_correction, in_sentence_repeat, consecutive_fillers
    const wordTexts = words.map(w => w.text);
    const fullText = wordTexts.join('');

    const deletePos = fullText.indexOf(deleteText);
    if (deletePos === -1) {
      skipped++;
      continue;
    }

    // 字符位置 → 词索引映射
    let charCount = 0;
    let deleteStartWord = null, deleteEndWord = null;

    for (let i = 0; i < wordTexts.length; i++) {
      const wordEnd = charCount + wordTexts[i].length;

      if (deleteStartWord === null && wordEnd > deletePos) {
        deleteStartWord = i;
      }
      if (wordEnd >= deletePos + deleteText.length) {
        deleteEndWord = i;
        break;
      }
      charCount = wordEnd;
    }

    if (deleteStartWord !== null && deleteEndWord !== null) {
      fineSegments.push({
        start: words[deleteStartWord].start,
        end: words[deleteEndWord].end
      });
    } else {
      skipped++;
    }
  }
}

console.log(`📝 精剪编辑: ${fineAnalysis.edits.length} 个 → ${fineSegments.length} 个时间段` +
  (skipped > 0 ? ` (跳过 ${skipped})` : ''));

// 合并到现有片段
const allSegments = [...existingSegments, ...fineSegments];
allSegments.sort((a, b) => a.start - b.start);

// 合并重叠/相邻片段（阈值 0.3s）
const merged = [];
let current = null;

for (const seg of allSegments) {
  if (!current) {
    current = { ...seg };
  } else if (seg.start <= current.end + 0.3) {
    current.end = Math.max(current.end, seg.end);
  } else {
    merged.push(current);
    current = { ...seg };
  }
}
if (current) merged.push(current);

// 如果第一段起点在前5秒内（录前内容），扩展到0
if (merged.length > 0 && merged[0].start < 5.0) {
  merged[0].start = 0;
}

fs.writeFileSync(segmentsFile, JSON.stringify(merged, null, 2));

console.log(`✅ 合并完成`);
console.log(`   句子级(5a): ${existingSegments.length} 段`);
console.log(`   精剪级(5b): ${fineSegments.length} 段`);
console.log(`   合并后: ${merged.length} 段`);

const totalDelete = merged.reduce((sum, s) => sum + (s.end - s.start), 0);
console.log(`   总删除: ${Math.floor(totalDelete / 60)}分${Math.floor(totalDelete % 60)}秒`);

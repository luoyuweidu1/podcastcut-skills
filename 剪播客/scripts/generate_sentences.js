#!/usr/bin/env node
/**
 * 步骤4: 从subtitles_words.json生成sentences.txt
 *
 * 用法: node generate_sentences.js [subtitles_words.json]
 * 输出: sentences.txt
 *
 * 格式: 句子索引|词索引范围|说话人|文本内容
 */

const fs = require('fs');
const path = require('path');

// 读取字级别转录
const wordsFile = process.argv[2] || '../1_转录/subtitles_words.json';
let words;

try {
  words = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
} catch (error) {
  console.error(`❌ 读取文件失败: ${wordsFile}`);
  console.error(error.message);
  process.exit(1);
}

let sentences = [];
let currentSentence = { words: [], speaker: null, startIdx: 0 };
let wordIdx = 0;

words.forEach((w, i) => {
  if (w.isSpeakerLabel) {
    // 遇到说话人标记
    if (currentSentence.words.length > 0) {
      // 保存当前句子
      const text = currentSentence.words.map(w => w.text).join('');
      sentences.push(`${sentences.length}|${currentSentence.startIdx}-${wordIdx-1}|${currentSentence.speaker}|${text}`);
      currentSentence = { words: [], speaker: null, startIdx: wordIdx };
    }
    currentSentence.speaker = w.speaker;
  } else if (!w.isGap) {
    currentSentence.words.push(w);
    wordIdx++;
    // 句子结束标志：。！？
    if (/[。！？.!?]/.test(w.text)) {
      const text = currentSentence.words.map(w => w.text).join('');
      sentences.push(`${sentences.length}|${currentSentence.startIdx}-${wordIdx-1}|${currentSentence.speaker}|${text}`);
      currentSentence = { words: [], speaker: currentSentence.speaker, startIdx: wordIdx };
    }
  }
});

// 保存最后一个句子
if (currentSentence.words.length > 0) {
  const text = currentSentence.words.map(w => w.text).join('');
  sentences.push(`${sentences.length}|${currentSentence.startIdx}-${wordIdx-1}|${currentSentence.speaker}|${text}`);
}

// 保存到文件
fs.writeFileSync('sentences.txt', sentences.join('\n'));

console.log(`✅ 已生成 sentences.txt`);
console.log(`   总句数: ${sentences.length}`);

// 统计说话人分布
const speakerCounts = {};
sentences.forEach(line => {
  const speaker = line.split('|')[2];
  speakerCounts[speaker] = (speakerCounts[speaker] || 0) + 1;
});

console.log('\n📊 说话人分布:');
Object.keys(speakerCounts).sort().forEach(speaker => {
  const count = speakerCounts[speaker];
  const pct = (count / sentences.length * 100).toFixed(1);
  console.log(`   ${speaker}: ${count}句 (${pct}%)`);
});

console.log('\n📝 前5句预览:');
sentences.slice(0, 5).forEach(line => {
  const parts = line.split('|');
  const text = parts[3].substring(0, 60);
  console.log(`${parts[0].padStart(3)}. [${parts[2]}] ${text}${parts[3].length > 60 ? '...' : ''}`);
});

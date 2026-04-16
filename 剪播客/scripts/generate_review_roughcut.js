#!/usr/bin/env node
/**
 * 生成 V7 粗剪审查页面 (review_roughcut.html)
 *
 * 读取转录和分析数据，注入橄榄绿编辑式模板。
 *
 * 用法: node generate_review_roughcut.js [options]
 *   --sentences   sentences.txt 路径
 *   --words       subtitles_words.json 路径
 *   --analysis    semantic_deep_analysis.json 路径
 *   --audio       音频文件相对路径 (默认: 1_转录/audio_seekable.mp3)
 *   --output      输出 HTML 路径
 *   --title       页面标题
 */

const fs = require('fs');
const path = require('path');

// ===== 参数解析 =====
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace('--', '');
  args[key] = process.argv[i + 1];
}

const sentencesFile = args.sentences || 'sentences.txt';
const wordsFile = args.words || '../1_转录/subtitles_words.json';
const analysisFile = args.analysis || 'semantic_deep_analysis.json';
const audioSrc = args.audio || '1_转录/audio_seekable.mp3';
const outputFile = args.output || '../review_roughcut.html';
const title = args.title || '粗剪审查';

// ===== 模板路径 =====
const scriptDir = path.dirname(process.argv[1] || __filename);
const templateFile = path.resolve(scriptDir, '../templates/review_roughcut.html');

// ===== 检查文件 =====
function check(f, name) {
  if (!fs.existsSync(f)) {
    console.error(`❌ 找不到${name}: ${f}`);
    process.exit(1);
  }
}
check(sentencesFile, '句子文件');
check(wordsFile, '词文件');
check(analysisFile, '语义分析');
check(templateFile, 'HTML模板');

// ===== 读取数据 =====
console.log('📖 读取数据...');
const sentences = fs.readFileSync(sentencesFile, 'utf8').split('\n').filter(l => l.trim());
const allWords = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));

const actualWords = allWords.filter(w => !w.isGap && !w.isSpeakerLabel);
console.log(`   句子: ${sentences.length}, 词: ${actualWords.length}`);

// ===== 构建删除集合 =====
const deletedSet = new Set();
const suggestedSet = new Set();
const blockMap = {};

if (analysis.sentences) {
  analysis.sentences.forEach(s => {
    if (s.action === 'delete') deletedSet.add(s.sentenceIdx);
    if (s.action === 'suggest_delete') suggestedSet.add(s.sentenceIdx);
  });
}

if (analysis.blocks) {
  analysis.blocks.forEach(block => {
    for (let i = block.range[0]; i <= block.range[1]; i++) {
      blockMap[i] = block;
    }
  });
}

// ===== 构建 S 数组（v6 模板格式）=====
console.log('🔨 构建数据...');
const S = [];

for (let i = 0; i < sentences.length; i++) {
  const parts = sentences[i].split('|');
  if (parts.length < 4) continue;

  const idx = parseInt(parts[0]);
  const [startWordIdx, endWordIdx] = parts[1].split('-').map(Number);
  const speaker = parts[2];
  const text = parts.slice(3).join('|'); // text may contain |

  // 计算时间
  const wordsArr = [];
  for (let wi = startWordIdx; wi <= Math.min(endWordIdx, actualWords.length - 1); wi++) {
    wordsArr.push(actualWords[wi]);
  }

  const startTime = wordsArr.length > 0 ? wordsArr[0].start : 0;
  const endTime = wordsArr.length > 0 ? wordsArr[wordsArr.length - 1].end : 0;

  const totalSec = Math.floor(startTime);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const timeStr = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;

  const entry = {
    idx,
    sp: speaker,
    t: text,
    s: Math.round(startTime * 100) / 100,
    e: Math.round(endTime * 100) / 100,
    ts: timeStr
  };

  if (deletedSet.has(idx)) {
    entry.ai = 1;
    if (blockMap[idx]) {
      entry.dt = blockMap[idx].type;
    }
  }

  if (suggestedSet.has(idx)) {
    entry.sug = 1;
    const sentInfo = analysis.sentences.find(s => s.sentenceIdx === idx);
    if (sentInfo && sentInfo.reason) {
      entry.sugReason = sentInfo.reason;
    }
  }

  S.push(entry);
}

// Fix endTime: extend each sentence's end to next sentence's start
// This ensures gaps between sentences are covered when deleting
for (let i = 0; i < S.length - 1; i++) {
  S[i].e = S[i + 1].s;
}
// First sentence: extend start to 0 if it's very close
if (S.length > 0 && S[0].s < 5) {
  S[0].s = 0;
}

// ===== 构建 BLK 数组 =====
const BLK = [];
if (analysis.blocks) {
  analysis.blocks.forEach(block => {
    const startSent = S.find(s => s.idx === block.range[0]);
    const endSent = S.find(s => s.idx === block.range[1]);
    const dur = (startSent && endSent) ? Math.round(endSent.e - startSent.s) : 0;
    const dm = Math.floor(dur / 60);
    const ds = dur % 60;
    BLK.push({
      id: block.id,
      r: block.range,
      type: block.type,
      reason: block.reason || '',
      dur: `${dm}:${String(ds).padStart(2, '0')}`
    });
  });
}

// ===== 章节导航 =====
// 优先使用分析文件中的 chapters（AI 生成的内容分段）
const CHAPS = [];
if (analysis.chapters && analysis.chapters.length > 0) {
  analysis.chapters.forEach(ch => {
    const sent = S.find(s => s.idx === ch.range[0]);
    CHAPS.push({
      startIdx: ch.range[0],
      endIdx: ch.range[1],
      time: sent ? sent.ts : ch.startTime || '0:00',
      title: ch.title,
      desc: ch.desc || ''
    });
  });
  console.log(`   章节: ${CHAPS.length} (来自分析文件)`);
} else {
  // Fallback: 自动均分
  const keptSentences = S.filter(s => !s.ai);
  const chapCount = Math.min(10, Math.max(4, Math.ceil(keptSentences.length / 80)));
  const chapSize = Math.ceil(keptSentences.length / chapCount);
  for (let i = 0; i < keptSentences.length; i += chapSize) {
    const first = keptSentences[i];
    CHAPS.push({
      startIdx: first.idx,
      time: first.ts,
      title: first.t.substring(0, 20) + (first.t.length > 20 ? '…' : ''),
      desc: ''
    });
  }
  console.log(`   章节: ${CHAPS.length} (自动生成)`);
}

// ===== 统计 =====
const deletedCount = S.filter(s => s.ai).length;
console.log(`   总句: ${S.length}, 删除: ${deletedCount}, 保留: ${S.length - deletedCount}`);
console.log(`   删除块: ${BLK.length}, 章节: ${CHAPS.length}`);

// ===== 注入模板 =====
console.log('📝 生成 HTML...');
let template = fs.readFileSync(templateFile, 'utf8');

template = template.replace('__SENTENCES_DATA__', JSON.stringify(S));
template = template.replace('__BLOCKS_DATA__', JSON.stringify(BLK));
template = template.replace('__CHAPTERS_DATA__', JSON.stringify(CHAPS));
template = template.replace(/__AUDIO_SRC__/g, audioSrc);
template = template.replace(/__TITLE__/g, title);
template = template.replace(/__PROJECT_NAME__/g, title);

fs.writeFileSync(outputFile, template);
const sizeKB = Math.round(fs.statSync(outputFile).size / 1024);

console.log(`✅ 已生成: ${outputFile} (${sizeKB}KB)`);

#!/usr/bin/env node
/**
 * 步骤6: 生成增强审查界面 review_enhanced.html
 *
 * 读取转录和分析数据，注入 HTML 模板，生成带动态播放器的审查页面。
 *
 * 用法: node generate_review_enhanced.js [options]
 *   --sentences   sentences.txt 路径       (默认: sentences.txt)
 *   --words       subtitles_words.json 路径 (默认: ../1_转录/subtitles_words.json)
 *   --analysis    semantic_deep_analysis.json 路径 (默认: semantic_deep_analysis.json)
 *   --fine        fine_analysis.json 路径   (默认: fine_analysis.json, 可选)
 *   --audio       音频文件相对路径          (默认: 1_转录/audio_seekable.mp3)
 *   --output      输出 HTML 路径           (默认: ../review_enhanced.html)
 *   --title       页面标题                 (默认: 播客审查稿 (可编辑))
 *
 * 关键设计:
 *   - 词索引用 actual_words（跳过 isGap 和 isSpeakerLabel）
 *   - 每句包含 words 数组（词级时间戳，用于手动编辑）
 *   - 精剪编辑预计算 ds/de 时间范围
 *   - 动态播放器实时跳过删除段
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
const fineFile = args.fine || 'fine_analysis.json';
const audioSrc = args.audio || '1_转录/audio_seekable.mp3';
const outputFile = args.output || '../review_enhanced.html';
const title = args.title || '播客审查稿 (可编辑)';

// ===== 模板路径 =====
const scriptDir = path.dirname(process.argv[1] || __filename);
const templateFile = path.resolve(scriptDir, '../templates/review_enhanced.html');

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

let fineAnalysis = null;
if (fs.existsSync(fineFile)) {
  fineAnalysis = JSON.parse(fs.readFileSync(fineFile, 'utf8'));
  console.log(`   精剪分析: ${fineAnalysis.edits.length} 个编辑`);
}

// ===== 构建 actual_words 索引（跳过 gap 和 speaker label）=====
const actualWords = allWords.filter(w => !w.isGap && !w.isSpeakerLabel);
console.log(`   总词条: ${allWords.length}, 实际词: ${actualWords.length}, 句子: ${sentences.length}`);

// ===== 构建删除集合 =====
const deletedSet = new Set();
const blockMap = {};  // sentenceIdx → block info

if (analysis.sentences) {
  analysis.sentences.forEach(s => {
    if (s.action === 'delete') {
      deletedSet.add(s.sentenceIdx);
    }
  });
}

if (analysis.blocks) {
  analysis.blocks.forEach(block => {
    for (let i = block.range[0]; i <= block.range[1]; i++) {
      blockMap[i] = block;
    }
  });
}

// ===== 构建精剪编辑映射 =====
const fineEditMap = {};  // sentenceIdx → edit
if (fineAnalysis) {
  fineAnalysis.edits.forEach((edit, idx) => {
    edit._idx = idx;
    // 如果同一句有多个编辑，保留第一个（优先级最高的）
    if (!fineEditMap[edit.sentenceIdx]) {
      fineEditMap[edit.sentenceIdx] = edit;
    }
  });
}

// ===== 构建 sentencesData =====
console.log('🔨 构建 sentencesData...');
const sentencesData = [];

for (let i = 0; i < sentences.length; i++) {
  const parts = sentences[i].split('|');
  if (parts.length < 4) continue;

  const idx = parseInt(parts[0]);
  const [startWordIdx, endWordIdx] = parts[1].split('-').map(Number);
  const speaker = parts[2];
  const text = parts[3];

  // 词级时间戳（actual_words 索引！）
  const wordsArr = [];
  for (let wi = startWordIdx; wi <= Math.min(endWordIdx, actualWords.length - 1); wi++) {
    const w = actualWords[wi];
    wordsArr.push({
      t: w.text,
      s: Math.round(w.start * 100) / 100,
      e: Math.round(w.end * 100) / 100
    });
  }

  const startTime = wordsArr.length > 0 ? wordsArr[0].s : 0;
  const totalSec = Math.floor(startTime);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const timeStr = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;

  const entry = {
    idx,
    speaker,
    text,
    startTime,
    endTime: 0,  // filled below
    timeStr,
    words: wordsArr,
    isAiDeleted: deletedSet.has(idx)
  };

  // 删除类型
  if (deletedSet.has(idx) && blockMap[idx]) {
    entry.deleteType = blockMap[idx].type;
  }

  // 精剪编辑
  const fe = fineEditMap[idx];
  if (fe) {
    const feEntry = {
      idx: fe._idx,
      type: fe.type,
      deleteText: fe.deleteText || '',
      keepText: fe.keepText || '',
      reason: fe.reason || ''
    };

    // 预计算精剪删除的时间范围
    if (fe.deleteText && wordsArr.length > 0) {
      if (fe.deleteText.startsWith('[静音')) {
        // 静音：找句内最大间隙
        let maxGap = 0, gapS = null, gapE = null;
        for (let wi = 1; wi < wordsArr.length; wi++) {
          const gap = wordsArr[wi].s - wordsArr[wi - 1].e;
          if (gap > maxGap) {
            maxGap = gap;
            gapS = wordsArr[wi - 1].e;
            gapE = wordsArr[wi].s;
          }
        }
        if (gapS !== null && maxGap > 1.0) {
          feEntry.ds = Math.round(gapS * 100) / 100;
          feEntry.de = Math.round(gapE * 100) / 100;
        }
      } else {
        // 文本匹配
        const wordTexts = wordsArr.map(w => w.t);
        const fullText = wordTexts.join('');
        const pos = fullText.indexOf(fe.deleteText);
        if (pos >= 0) {
          let charCount = 0, delStartWord = null, delEndWord = null;
          for (let wi = 0; wi < wordTexts.length; wi++) {
            const wEnd = charCount + wordTexts[wi].length;
            if (delStartWord === null && wEnd > pos) delStartWord = wi;
            if (wEnd >= pos + fe.deleteText.length) { delEndWord = wi; break; }
            charCount = wEnd;
          }
          if (delStartWord !== null && delEndWord !== null) {
            feEntry.ds = wordsArr[delStartWord].s;
            feEntry.de = wordsArr[delEndWord].e;
          }
        }
      }
    }

    entry.fineEdit = feEntry;
  }

  sentencesData.push(entry);
}

// 填充 endTime（下一句的 startTime，最后一句用最后词的 end）
for (let i = 0; i < sentencesData.length; i++) {
  if (i + 1 < sentencesData.length) {
    sentencesData[i].endTime = sentencesData[i + 1].startTime;
  } else {
    const w = sentencesData[i].words;
    sentencesData[i].endTime = w.length > 0 ? w[w.length - 1].e : sentencesData[i].startTime + 1;
  }
}

// ===== 统计 =====
const totalSentences = sentencesData.length;
const deletedCount = sentencesData.filter(s => s.isAiDeleted).length;
const fineEditCount = sentencesData.filter(s => s.fineEdit).length;
console.log(`   句子: ${totalSentences}, 删除: ${deletedCount}, 精剪: ${fineEditCount}`);

// ===== 构建 blocksData =====
const blocksDataArr = [];
if (analysis.blocks) {
  analysis.blocks.forEach(block => {
    const entry = {
      id: block.id,
      range: block.range,
      type: block.type,
      reason: block.reason || ''
    };
    // 计算时长
    const startSent = sentencesData.find(s => s.idx === block.range[0]);
    const endSent = sentencesData.find(s => s.idx === block.range[1]);
    if (startSent && endSent) {
      const dur = Math.round(endSent.endTime - startSent.startTime);
      const dm = Math.floor(dur / 60);
      const ds = dur % 60;
      entry.duration = `${dm}:${String(ds).padStart(2, '0')}`;
    } else {
      entry.duration = '0:00';
    }
    blocksDataArr.push(entry);
  });
}

// ===== 构建说话人样式和类映射 =====
const speakerColors = ['var(--blue)', 'var(--green)', 'var(--purple)', 'var(--orange, #d97706)', 'var(--red, #dc2626)'];
const uniqueSpeakers = [...new Set(sentencesData.map(s => s.speaker))];
const speakerStyles = uniqueSpeakers.map((sp, i) => {
  return `.s-speaker.sp-${i} { color: ${speakerColors[i % speakerColors.length]}; }`;
}).join('\n');
const speakerClassParts = uniqueSpeakers.map((sp, i) => {
  return `s.speaker === ${JSON.stringify(sp)} ? 'sp-${i}'`;
});
speakerClassParts.push(`'sp-0'`);
const speakerClassExpr = speakerClassParts.join(' : ');

// ===== 注入模板 =====
console.log('📝 生成 HTML...');
let template = fs.readFileSync(templateFile, 'utf8');

const dataJson = JSON.stringify(sentencesData);
template = template.replace('__SENTENCES_DATA__', dataJson);
template = template.replace('__BLOCKS_DATA__', JSON.stringify(blocksDataArr));
template = template.replace('__AI_DELETED_COUNT__', String(deletedCount));
template = template.replace('__TOTAL_SENTENCES__', String(totalSentences));
template = template.replace('__SPEAKER_STYLES__', speakerStyles);
template = template.replace('__SPEAKER_CLASS_FUNC__', speakerClassExpr);
template = template.replace(/__AUDIO_SRC__/g, audioSrc);
template = template.replace(/__TITLE__/g, title);

fs.writeFileSync(outputFile, template);
const sizeKB = Math.round(fs.statSync(outputFile).size / 1024);

console.log(`✅ 已生成: ${outputFile} (${sizeKB}KB)`);
console.log(`   句子: ${totalSentences}, AI删除: ${deletedCount}, 精剪: ${fineEditCount}`);
console.log(`   词级时间戳: ${sentencesData.reduce((sum, s) => sum + s.words.length, 0)} 个`);

#!/usr/bin/env node
/**
 * 生成 V7 审查页面（统一模板，覆盖粗剪/精剪两态）。
 *
 * 读取转录和分析数据，注入橄榄绿编辑式模板。
 * - 不传 `--fine` → 粗剪态，输出文件名默认 `review_roughcut.html`、导出 `delete_segments_roughcut.json`
 * - 传 `--fine fine_analysis.json` → 精剪态（FE 非空），输出文件名按约定为 `review_enhanced.html`、导出 `delete_segments_edited.json`
 *
 * 用法: node generate_review.js [options]
 *   --sentences   sentences.txt 路径
 *   --words       subtitles_words.json 路径
 *   --analysis    semantic_deep_analysis.json 路径
 *   --fine        fine_analysis.json 路径（精剪态需要）
 *   --roughcut    delete_segments_roughcut.json 路径（精剪态用于显示半句删除底稿）
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
// 精剪阶段才会提供这两个；粗剪阶段省略 → FE=[]、ROUGHCUT_*=空，行为同旧
const fineFile = args.fine || null;
const roughcutFile = args.roughcut || null;

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
    ts: timeStr,
    // 逐词时间戳（半句删除：选区→词→时间段 的映射依赖它）
    w: wordsArr.map(w => ({
      t: w.text,
      s: Math.round(w.start * 100) / 100,
      e: Math.round(w.end * 100) / 100
    }))
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

// ===== 精剪阶段数据（FE / 粗剪导出）=====
// 句子 meta：用于把 fine_analysis 的 global wordRange 映射为句内 char 偏移
const sentInfo = {};
for (let i = 0; i < sentences.length; i++) {
  const parts = sentences[i].split('|');
  if (parts.length < 4) continue;
  const sidx = parseInt(parts[0]);
  const [sw, we] = parts[1].split('-').map(Number);
  const offsets = []; let acc = 0;
  for (let wi = sw; wi <= Math.min(we, actualWords.length - 1); wi++) {
    offsets.push(acc);
    acc += actualWords[wi].text.length;
  }
  sentInfo[sidx] = { wordStart: sw, wordEnd: we, charOffsets: offsets, charLen: acc };
}

// FE：fine_analysis.edits[] → [{idx, cs, ce, s, e, type, reason, ord}]
let FE = [];
if (fineFile && fs.existsSync(fineFile)) {
  const fa = JSON.parse(fs.readFileSync(fineFile, 'utf8'));
  const edits = (fa.edits || []).concat(fa.extraFineEdits || []);
  const ordBySent = {};
  for (const ed of edits) {
    const tStart = ed.ds !== undefined ? ed.ds : (ed.deleteStart !== undefined ? ed.deleteStart : null);
    const tEnd   = ed.de !== undefined ? ed.de : (ed.deleteEnd   !== undefined ? ed.deleteEnd   : null);
    const isTimeOnly = (ed.type === 'silence' || ed.type === 'silence_merged');
    const wr = ed.wordRange;

    if (isTimeOnly) {
      // 静音类：无 wordRange，时间维度独立条目（cs/ce=null 不参与 txtHtml 渲染，
      // 但参与 doExport / playback skip / computeStats / incomingSilences 标记）
      if (ed.sentenceIdx === undefined || tStart == null || tEnd == null) continue;
      const ord = (ordBySent[ed.sentenceIdx] = (ordBySent[ed.sentenceIdx] || 0) + 1);
      FE.push({
        idx: ed.sentenceIdx, cs: null, ce: null,
        s: tStart, e: tEnd,
        type: ed.type, reason: ed.reason || '',
        duration: ed.duration || Math.round((tEnd - tStart) * 100) / 100,
        ord
      });
      continue;
    }

    if (!wr || wr.length !== 2) continue;
    // 找宿主句子（线性扫描；规模小）
    let hostIdx = null, hostMeta = null;
    for (const [k, m] of Object.entries(sentInfo)) {
      if (wr[0] >= m.wordStart && wr[0] <= m.wordEnd) { hostIdx = +k; hostMeta = m; break; }
    }
    if (hostMeta == null) continue;
    const posA = wr[0] - hostMeta.wordStart;
    const posB = Math.min(wr[1] - hostMeta.wordStart, hostMeta.charOffsets.length - 1);
    if (posA < 0 || posA >= hostMeta.charOffsets.length) continue;
    const cs = hostMeta.charOffsets[posA];
    // 优先用 deleteText.length 算 ce（与页面渲染的 full.slice(cs,ce) 严格对齐，避免 wordRange 末位歧义）
    let ce;
    if (ed.deleteText && typeof ed.deleteText === 'string') {
      ce = cs + ed.deleteText.length;
    } else {
      ce = (posB < hostMeta.charOffsets.length - 1) ? hostMeta.charOffsets[posB + 1] : hostMeta.charLen;
    }
    if (ce > hostMeta.charLen) ce = hostMeta.charLen;
    const ord = (ordBySent[hostIdx] = (ordBySent[hostIdx] || 0) + 1);
    FE.push({
      idx: hostIdx, cs, ce,
      s: tStart, e: tEnd,
      type: ed.type || 'edit',
      reason: ed.reason || '',
      ord
    });
  }
  // 过滤掉时间无效的
  FE = FE.filter(f => f.s != null && f.e != null && f.e > f.s);
  console.log(`   精剪标 (FE): ${FE.length} 条`);
}

// 粗剪导出（精剪阶段读取）→ ROUGHCUT_DELETES（整句删除数组）+ ROUGHCUT_PARTIALS（半句删除映射）
let ROUGHCUT_DELETES = [];
let ROUGHCUT_PARTIALS = {};
if (roughcutFile && fs.existsSync(roughcutFile)) {
  const rc = JSON.parse(fs.readFileSync(roughcutFile, 'utf8'));
  ROUGHCUT_DELETES = rc.sentence_deletes || [];
  ROUGHCUT_PARTIALS = rc.partial_deletes || {};
  console.log(`   粗剪导出: ${ROUGHCUT_DELETES.length} 句整删, ${Object.keys(ROUGHCUT_PARTIALS).length} 句有半句删`);
}

// 句首停顿标记：silence/silence_merged 的感知位置在下一句开头
// 把每条静音传给"下一个非删除句"作为 incomingSilences，点击 toggle 同一个 FE
const INCOMING_SILENCES = {};
{
  const initDelSet = new Set(ROUGHCUT_DELETES);
  S.forEach(x => { if (x.ai || x.sug) initDelSet.add(x.idx); });
  FE.forEach(f => {
    if (f.type !== 'silence' && f.type !== 'silence_merged') return;
    let nextIdx = null;
    for (const sObj of S) {
      if (sObj.idx <= f.idx) continue;
      if (initDelSet.has(sObj.idx)) continue;
      nextIdx = sObj.idx;
      break;
    }
    if (nextIdx == null) return;
    const dur = f.duration || Math.max(0, (f.e || 0) - (f.s || 0));
    (INCOMING_SILENCES[nextIdx] = INCOMING_SILENCES[nextIdx] || []).push({
      duration: Math.round(dur * 10) / 10,
      key: `${f.idx}@${f.ord}`,
      fromIdx: f.idx
    });
  });
  const cnt = Object.keys(INCOMING_SILENCES).length;
  if (cnt > 0) console.log(`   句首停顿标记: ${cnt} 个句子接收（共 ${Object.values(INCOMING_SILENCES).reduce((a,v)=>a+v.length,0)} 标）`);
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
template = template.replace('__FINE_EDITS_DATA__', JSON.stringify(FE));
template = template.replace('__ROUGHCUT_DELETES_DATA__', JSON.stringify(ROUGHCUT_DELETES));
template = template.replace('__ROUGHCUT_PARTIALS_DATA__', JSON.stringify(ROUGHCUT_PARTIALS));
template = template.replace('__INCOMING_SILENCES_DATA__', JSON.stringify(INCOMING_SILENCES));
template = template.replace(/__AUDIO_SRC__/g, audioSrc);
template = template.replace(/__TITLE__/g, title);
template = template.replace(/__PROJECT_NAME__/g, title);

fs.writeFileSync(outputFile, template);
const sizeKB = Math.round(fs.statSync(outputFile).size / 1024);

console.log(`✅ 已生成: ${outputFile} (${sizeKB}KB)`);

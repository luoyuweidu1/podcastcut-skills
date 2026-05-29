#!/usr/bin/env node
/**
 * 精修 fine_analysis.json 中标记了 _refinePoints 的编辑时间戳。
 *
 * 在 merge_llm_fine.js 输出 fine_analysis.json 后、生成审查页之前执行。
 * 扫描所有编辑的 _refinePoints，调用 refine_boundaries.py 做波形 onset detection，
 * 用精修结果更新 deleteStart/deleteEnd。
 *
 * 用法:
 *   node refine_fine_analysis.js --analysis-dir <dir> --audio <path>
 *
 * 参数:
 *   --analysis-dir   包含 fine_analysis.json 的目录
 *   --audio          原始音频文件路径
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse args
let analysisDir = process.cwd();
let audioPath = null;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--analysis-dir' && process.argv[i + 1]) {
    analysisDir = path.resolve(process.argv[++i]);
  } else if (process.argv[i] === '--audio' && process.argv[i + 1]) {
    audioPath = path.resolve(process.argv[++i]);
  }
}

const fineAnalysisPath = path.join(analysisDir, 'fine_analysis.json');
const scriptDir = __dirname;
const refinePyPath = path.join(scriptDir, 'refine_boundaries.py');

if (!fs.existsSync(fineAnalysisPath)) {
  console.error(`❌ fine_analysis.json 不存在: ${fineAnalysisPath}`);
  process.exit(1);
}

if (!audioPath) {
  // 默认音频选择顺序（onset 能量谷底搜索要求源码尽量无损 / 高保真）：
  //   1) audio_original.*    — 原始未压缩源（最佳）
  //   2) audio_seekable.mp3  — CBR 192k MP3，回退选项；重压缩会平滑能量包络
  //   3) audio.mp3           — 16kHz 降采样的 ASR 用版本，最差回退
  // 优先用 original 是因为 MP3 重压缩会让 onset 边界检测偏差几十 ms。
  const transcribeDir = path.join(analysisDir, '..', '1_转录');
  let originals = [];
  try {
    originals = fs.readdirSync(transcribeDir).filter(f => f.startsWith('audio_original.'));
  } catch (e) {}
  if (originals.length > 0) {
    audioPath = path.join(transcribeDir, originals[0]);
  } else {
    const seekable = path.join(analysisDir, '..', '1_转录', 'audio_seekable.mp3');
    if (fs.existsSync(seekable)) {
      audioPath = seekable;
      console.warn('⚠️  未找到 audio_original.*，回退到 audio_seekable.mp3（重压缩 MP3，onset 精度会略降）');
    } else {
      const asrAudio = path.join(analysisDir, '..', '1_转录', 'audio.mp3');
      if (fs.existsSync(asrAudio)) {
        audioPath = asrAudio;
        console.warn('⚠️  仅找到 audio.mp3（16kHz ASR 版），onset 检测精度会显著降低');
      } else {
        console.error('❌ 未指定 --audio，且默认音频路径不存在');
        process.exit(1);
      }
    }
  }
}

console.log(`🔍 Refine fine_analysis: onset detection 精修`);
console.log(`   fine_analysis: ${fineAnalysisPath}`);
console.log(`   audio: ${audioPath}`);

// 加载 fine_analysis
const data = JSON.parse(fs.readFileSync(fineAnalysisPath, 'utf8'));
const edits = data.edits || [];

// 收集所有 _refinePoints
const allPoints = [];
const pointToEdit = []; // 追踪每个 point 属于哪个 edit 和 point index

for (let ei = 0; ei < edits.length; ei++) {
  const edit = edits[ei];
  if (!edit._refinePoints || edit._refinePoints.length === 0) continue;

  for (let pi = 0; pi < edit._refinePoints.length; pi++) {
    const pt = edit._refinePoints[pi];
    allPoints.push(pt);
    pointToEdit.push({ editIdx: ei, pointIdx: pi, type: pt.type });
  }
}

if (allPoints.length === 0) {
  console.log('   没有需要精修的切割点，跳过');
  process.exit(0);
}

console.log(`   收集到 ${allPoints.length} 个待精修点`);

// 写临时 JSON 文件
const tempPointsPath = path.join(analysisDir, '_refine_points_temp.json');
fs.writeFileSync(tempPointsPath, JSON.stringify(allPoints));

// 调用 refine_boundaries.py
let results;
try {
  const cmd = `python3 "${refinePyPath}" --audio "${audioPath}" --points-file "${tempPointsPath}"`;
  const stdout = execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120000
  });
  results = JSON.parse(stdout);
} catch (err) {
  console.error(`❌ refine_boundaries.py 执行失败:`, err.message);
  // 清理临时文件
  try { fs.unlinkSync(tempPointsPath); } catch (e) {}
  process.exit(1);
}

// 清理临时文件
try { fs.unlinkSync(tempPointsPath); } catch (e) {}

// 应用精修结果
let applied = 0;
let skipped = 0;

for (let i = 0; i < results.length; i++) {
  const result = results[i];
  const { editIdx, type } = pointToEdit[i];
  const edit = edits[editIdx];

  if (result.confidence < 0.5) {
    skipped++;
    continue;
  }

  const delta = result.refined - result.original;
  if (Math.abs(delta) < 0.001) {
    skipped++;
    continue;
  }

  // 根据 type 更新对应字段（方向约束：只允许边界向删除区域内部移动）
  // 向内 snap 的最大允许位移（30ms）——超过这个量大概率是 refine 把谷底找到了
  // 短 filler 词（"啊/呃/嗯"）的能量包络中段，而不是真正的词边界；硬限防止吞掉大部分词。
  const MAX_INWARD_SHIFT_S = 0.03;
  if (type === 'onset_pullback') {
    // 句首填充词的 onset 拉回：deleteStart 只能往左移（refined <= original），
    // 覆盖 ASR 起音延迟。窗口已被 merge 阶段卡在前词尾巴之内。
    const oldVal = edit.deleteStart ?? edit.ds ?? 0;
    if (result.refined > oldVal + 0.001) {
      skipped++;
      continue;
    }
    edit._originalDeleteStart = oldVal;
    edit.deleteStart = result.refined;
    if (edit.ds != null) edit.ds = result.refined;
    applied++;
    console.log(`   ✅ Edit #${edit.idx} ${edit.type}: start ${oldVal.toFixed(4)} ← ${result.refined.toFixed(4)} (Δ${(delta * 1000).toFixed(1)}ms onset 拉回)`);
  } else if (type === 'partial_start' || type === 'filler_start') {
    const oldVal = edit.deleteStart ?? edit.ds ?? 0;
    // deleteStart 只能往右移（refined >= original）
    if (result.refined < oldVal - 0.001) {
      skipped++;
      continue;
    }
    // 防短 filler 被吞：向内位移 > 30ms 就拒绝（保留 ASR 边界）
    if (result.refined - oldVal > MAX_INWARD_SHIFT_S) {
      skipped++;
      console.log(`   ⏭️  Edit #${edit.idx} ${edit.type}: start refine 向内移动 ${((result.refined - oldVal) * 1000).toFixed(1)}ms > 30ms 上限，拒绝（保留 ASR 边界 ${oldVal.toFixed(4)}）`);
      continue;
    }
    edit._originalDeleteStart = oldVal;
    edit.deleteStart = result.refined;
    if (edit.ds != null) edit.ds = result.refined;
    applied++;
    console.log(`   ✅ Edit #${edit.idx} ${edit.type}: start ${oldVal.toFixed(4)} → ${result.refined.toFixed(4)} (Δ${(delta * 1000).toFixed(1)}ms)`);
  } else if (type === 'partial_end' || type === 'filler_end') {
    const oldVal = edit.deleteEnd ?? edit.de ?? 0;
    // deleteEnd 只能往左移（refined <= original）
    if (result.refined > oldVal + 0.001) {
      skipped++;
      continue;
    }
    // 防短 filler 被吞：向内位移 > 30ms 就拒绝
    if (oldVal - result.refined > MAX_INWARD_SHIFT_S) {
      skipped++;
      console.log(`   ⏭️  Edit #${edit.idx} ${edit.type}: end refine 向内移动 ${((oldVal - result.refined) * 1000).toFixed(1)}ms > 30ms 上限，拒绝（保留 ASR 边界 ${oldVal.toFixed(4)}）`);
      continue;
    }
    edit._originalDeleteEnd = oldVal;
    edit.deleteEnd = result.refined;
    if (edit.de != null) edit.de = result.refined;
    applied++;
    console.log(`   ✅ Edit #${edit.idx} ${edit.type}: end ${oldVal.toFixed(4)} → ${result.refined.toFixed(4)} (Δ${(delta * 1000).toFixed(1)}ms)`);
  }
}

console.log(`\n📊 精修结果: ${applied} applied, ${skipped} skipped (low confidence or no change)`);

// 备份原文件
const backupPath = fineAnalysisPath.replace('.json', '_pre_refine.json');
fs.copyFileSync(fineAnalysisPath, backupPath);
console.log(`   备份: ${backupPath}`);

// 清理 _refinePoints 字段（已应用，不需要保留在输出中）
for (const edit of edits) {
  delete edit._refinePoints;
}

// 在 summary 中记录精修信息
if (!data.summary) data.summary = {};
data.summary.onsetDetection = {
  totalPoints: allPoints.length,
  applied,
  skipped
};

// 写回
fs.writeFileSync(fineAnalysisPath, JSON.stringify(data, null, 2));
console.log(`✅ 已更新 fine_analysis.json（${applied} 个切割点精修完成）`);

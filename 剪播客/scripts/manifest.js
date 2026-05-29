#!/usr/bin/env node
/**
 * project.json 状态清单帮手（阶段0：拆分重构的基石）
 *
 * 契约见 docs/refactor/project-manifest.md。一份 manifest 同时服务：
 *   - 各单元交接（文件契约 + 状态）
 *   - 编排器续跑（current_stage + 各 status）
 *   - 未来网页 Agent 的 stepper（pipeline[].status）
 *
 * 用法：
 *   node manifest.js init <baseDir> --audio <源音频> --user <id> [--title <t>]
 *   node manifest.js set-stage <baseDir> <stageId> <status> [--summary '<json>'] [--outputs '<json>'] [--note '<text>']
 *   node manifest.js set-speakers <baseDir> --count <N> --mapping '<json>' [--verified]
 *   node manifest.js set-audio <baseDir> [--original <rel>] [--asr <rel>] [--seekable <rel>]
 *   node manifest.js get <baseDir>
 *   node manifest.js current [outputDir]        # 读 .current_project
 *
 *   baseDir 形如 output/<项目>/剪播客
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SCHEMA_VERSION = '1.0';

// 静态流水线定义（所有项目一致；optional/needs_review 见契约 §6）
const STAGES = [
  { id: 'transcribe',    label: '转录',     optional: false, needs_review: false },
  { id: 'roughcut',      label: '粗剪',     optional: false, needs_review: true  },
  { id: 'fine',          label: '精剪',     optional: false, needs_review: true  },
  { id: 'execute',       label: '执行剪辑', optional: false, needs_review: false },
  { id: 'qa',            label: '质检',     optional: true,  needs_review: true  },
  { id: 'audio_quality', label: '音质处理', optional: true,  needs_review: true  },
  { id: 'post',          label: '后期',     optional: true,  needs_review: true  },
];
const STATUSES = ['pending', 'in_progress', 'awaiting_review', 'approved', 'done', 'skipped', 'failed'];
const COMPLETE = new Set(['approved', 'done', 'skipped']);

const now = () => new Date().toISOString();
const mpath = (baseDir) => path.join(baseDir, 'project.json');
const outputDirOf = (baseDir) => path.resolve(baseDir, '..', '..');        // output/
const projectIdOf = (baseDir) => path.basename(path.resolve(baseDir, '..')); // <项目>
const pointerOf = (baseDir) => path.join(outputDirOf(baseDir), '.current_project');

function load(baseDir) {
  const p = mpath(baseDir);
  if (!fs.existsSync(p)) throw new Error(`project.json 不存在: ${p}（先 init）`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function save(baseDir, m) {
  m.project.updated_at = now();
  fs.writeFileSync(mpath(baseDir), JSON.stringify(m, null, 2));
}
function probe(audio) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -show_entries stream=sample_rate,channels -of default=noprint_wrappers=1 ${JSON.stringify(audio)}`,
      { encoding: 'utf8' }
    );
    const g = (k) => { const m = out.match(new RegExp(k + '=([0-9.]+)')); return m ? Number(m[1]) : null; };
    return { duration_sec: g('duration'), sample_rate: g('sample_rate'), channels: g('channels') };
  } catch { return { duration_sec: null, sample_rate: null, channels: null }; }
}
// 简易 --key value 解析
function parseFlags(args) {
  const f = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      const v = (i + 1 < args.length && !args[i + 1].startsWith('--')) ? args[++i] : true;
      f[k] = v;
    }
  }
  return f;
}

function cmdInit(baseDir, f) {
  fs.mkdirSync(baseDir, { recursive: true });
  const id = projectIdOf(baseDir);
  const probed = f.audio ? probe(f.audio) : {};
  // 探测已存在的派生音频文件
  const trans = path.join(baseDir, '1_转录');
  const find = (prefix) => {
    if (!fs.existsSync(trans)) return '';
    const hit = fs.readdirSync(trans).find((x) => x.startsWith(prefix) && !x.startsWith('._'));
    return hit ? `1_转录/${hit}` : '';
  };
  const m = {
    schema_version: SCHEMA_VERSION,
    project: {
      id,
      title: f.title || '',
      user: f.user || process.env.PODCASTCUT_USER || 'default',
      created_at: now(),
      updated_at: now(),
      base_dir: path.relative(path.resolve(outputDirOf(baseDir), '..'), baseDir) || baseDir,
    },
    audio: {
      source: f.audio || '',
      original: find('audio_original'),
      asr: find('audio.mp3') ? '1_转录/audio.mp3' : '',
      seekable: find('audio_seekable'),
      ...probed,
    },
    speakers: { count: null, mapping: {}, verified: false },
    current_stage: 'transcribe',
    pipeline: STAGES.map((s) => ({
      id: s.id, label: s.label, status: 'pending',
      optional: s.optional, needs_review: s.needs_review,
      started_at: null, completed_at: null,
      outputs: {}, summary: {},
      ...(s.needs_review ? { review: { approved_at: null, by: null, notes: '' } } : {}),
    })),
  };
  save(baseDir, m);
  fs.writeFileSync(pointerOf(baseDir), id + '\n');
  console.log(`✅ project.json 已创建: ${mpath(baseDir)}`);
  console.log(`   当前项目指针: ${pointerOf(baseDir)} → ${id}`);
}

function cmdSetStage(baseDir, stageId, status, f) {
  if (!STATUSES.includes(status)) throw new Error(`非法状态 "${status}"，可选: ${STATUSES.join(', ')}`);
  const m = load(baseDir);
  const st = m.pipeline.find((s) => s.id === stageId);
  if (!st) throw new Error(`未知阶段 "${stageId}"`);
  if (status === 'in_progress' && !st.started_at) st.started_at = now();
  if (COMPLETE.has(status)) st.completed_at = now();
  if (status === 'approved' && st.review) st.review.approved_at = now();
  if (f.note && st.review) st.review.notes = f.note;
  if (f.summary) { try { Object.assign(st.summary, JSON.parse(f.summary)); } catch { console.error('⚠️ --summary 不是合法 JSON'); } }
  if (f.outputs) { try { Object.assign(st.outputs, JSON.parse(f.outputs)); } catch { console.error('⚠️ --outputs 不是合法 JSON'); } }
  st.status = status;
  // current_stage = 第一个未完成阶段
  const next = m.pipeline.find((s) => !COMPLETE.has(s.status));
  m.current_stage = next ? next.id : null;
  save(baseDir, m);
  console.log(`✅ ${stageId} → ${status}  (current_stage: ${m.current_stage || '全部完成'})`);
}

function cmdSetSpeakers(baseDir, f) {
  const m = load(baseDir);
  if (f.count) m.speakers.count = Number(f.count);
  if (f.mapping) { try { m.speakers.mapping = JSON.parse(f.mapping); } catch { console.error('⚠️ --mapping 不是合法 JSON'); } }
  if (f.verified) m.speakers.verified = true;
  save(baseDir, m);
  console.log(`✅ 说话人: ${m.speakers.count} 人 ${JSON.stringify(m.speakers.mapping)}`);
}

function cmdSetAudio(baseDir, f) {
  const m = load(baseDir);
  ['original', 'asr', 'seekable', 'source'].forEach((k) => { if (f[k]) m.audio[k] = f[k]; });
  save(baseDir, m);
  console.log(`✅ 音频路径已更新`);
}

// ── CLI ──
const [, , cmd, ...rest] = process.argv;
try {
  if (cmd === 'init')             { cmdInit(rest[0], parseFlags(rest.slice(1))); }
  else if (cmd === 'set-stage')   { cmdSetStage(rest[0], rest[1], rest[2], parseFlags(rest.slice(3))); }
  else if (cmd === 'set-speakers'){ cmdSetSpeakers(rest[0], parseFlags(rest.slice(1))); }
  else if (cmd === 'set-audio')   { cmdSetAudio(rest[0], parseFlags(rest.slice(1))); }
  else if (cmd === 'get')         { console.log(JSON.stringify(load(rest[0]), null, 2)); }
  else if (cmd === 'current')     { const p = path.join(rest[0] || 'output', '.current_project'); console.log(fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '(无)'); }
  else { console.log('用法见文件头注释。命令: init | set-stage | set-speakers | set-audio | get | current'); process.exit(cmd ? 1 : 0); }
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}

module.exports = { STAGES, STATUSES, COMPLETE, load, save };

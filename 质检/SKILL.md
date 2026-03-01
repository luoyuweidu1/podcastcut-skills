---
name: podcastcut:质检
description: |
  播客剪辑质检：两阶段自动检测。
  Phase A（数据层）：在 cut_audio 之后检查 delete_segments 的正确性——恢复句是否被误剪、手动删除是否生效、切点静音、大段删除衔接。
  Phase B（信号层）：对剪辑后音频做信号分析（能量/频谱/静音）+ 可选 Gemini AI 听感评估，标记需要人工复听的片段。
  触发词：质检、审查剪辑、检查音频、audit、QA、检查一下剪辑结果、check edit
---

<!--
input: delete_segments + 剪辑后音频
output: QA 报告（JSON + 可读摘要）
pos: 在 /podcastcut-edit 之后使用

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. ../安装/SKILL.md 的 symlink 注册
-->

# 播客剪辑质检

> 两阶段自动检测：先查数据层（delete_segments 是否正确），再查信号层（音频是否平滑）。目标是把大部分机械性检查交给脚本，让用户只需关注少数真正需要人耳判断的地方。

---

## ⚠️ 启动时必须询问

**在开始质检之前，必须先询问用户：**

```
请提供以下信息：

1. **output 目录路径**
   - 例如：`output/2026-02-27_meeting_02`
   - 需要包含 `1_转录/`、`2_分析/`、`3_成品/`

2. **剪辑后的播客音频路径**（Phase B 需要）
   - 例如：`output/.../3_成品/podcast_精剪版_v14_trimmed.mp3`

3. **（可选）Gemini API Key**
   - 如果已配置环境变量 GEMINI_API_KEY，会自动启用 AI 听感评估
   - 没有也没关系，Phase A + 信号层分析已能检出大多数问题
```

---

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                    播客剪辑质检                            │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Phase A: 数据层质检 (audit_cut.js)                  │ │
│  │                                                     │ │
│  │  输入: delete_segments + fine_analysis + sentences   │ │
│  │                                                     │ │
│  │  检查 1: 恢复句完整性（排除有意 fine edit）            │ │
│  │  检查 2: 用户手动删除是否生效                          │ │
│  │  检查 3: 切点静音检测                                 │ │
│  │  检查 4: 大段删除衔接审查                              │ │
│  │                                                     │ │
│  │  → auto_fix.js 自动修复                              │ │
│  │  → 重新剪辑 → 再验证                                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                         ↓                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Phase B: 信号层质检                                 │ │
│  │                                                     │ │
│  │  输入: 剪辑后音频 (MP3/WAV)                          │ │
│  │                                                     │ │
│  │  Layer 1: 信号分析 (signal_analysis.py / librosa)    │ │
│  │    - 频谱跳变 (MFCC cosine similarity)              │ │
│  │    - 不自然静音 (silence duration)                    │ │
│  │    - 播客模式：忽略 energy_jump（全是假阳性）          │ │
│  │                                                     │ │
│  │  Layer 2: AI 听感评估 (ai_listen.py / Gemini, 可选) │ │
│  │    - 全局采样：6 个 30s 片段评估整体节奏              │ │
│  │    - 可疑复查：Layer 1 的 HIGH 问题 AI 二次确认       │ │
│  │                                                     │ │
│  │  Layer 3: 综合报告 (report_generator.py)             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  输出: audit_report.json + qa_report.json + qa_summary.md│
└──────────────────────────────────────────────────────────┘
```

**设计原则**：Phase A 无需音频、纯数据校验；Phase B 的 Layer 1 无需 API Key 纯本地运算；Layer 2 是锦上添花。

---

## 快速使用

```
用户: 帮我检查一下剪辑质量
用户: 质检这个播客
用户: QA 我的播客
用户: 审查剪辑
用户: check edit
```

---

## Phase A: 数据层质检

在 cut_audio 剪辑完成后、用户审听前运行。也可以在用户审听反馈后、重剪之前运行，确认所有反馈都已正确应用。

### A1: 审查

```bash
node <skill_dir>/scripts/audit_cut.js <output_dir>
```

`<output_dir>` 是包含 `1_转录/`、`2_分析/`、`3_成品/` 的那个目录。

脚本会做 4 项检查：

**检查 1 — 恢复句完整性**
遍历所有用户恢复的句子，检查每个 word 是否被 delete segment 覆盖。关键改进：会排除"有意的 fine edit"（如口吃/填充词删除），只报告无法用 fine_analysis 解释的异常覆盖。这能发现：
- 旧 HTML 导出遗留的 wholeSentence segment
- 跨句 segment 意外覆盖（原始 AI 分析的 segment 未在 restore 时清除）

**检查 2 — 用户手动删除**
读取 `user_corrections.added_deletions`（用户确认的整句删除），验证对应时间范围确实有 delete segment 覆盖。`missed_catches`（AI 建议项）仅在有精确时间戳时才检查。

**检查 3 — 切点静音**
扫描所有相邻 segment 之间的保留区间。如果保留区间内没有语音内容且时长 > 0.3s，标记为潜在停顿。这些停顿在原始录音中不明显，但删除前后内容后会暴露出来。

**检查 4 — 大段删除**
列出所有 > 5s 的删除段，附上前后文本。这些无法自动判断好坏，但能帮用户快速定位需要重点听的位置。

### A2: 自动修复

```bash
# 先 dry-run 看看会改什么
node <skill_dir>/scripts/auto_fix.js <output_dir> --dry-run

# 确认后执行（会自动备份原文件）
node <skill_dir>/scripts/auto_fix.js <output_dir>
```

自动修复覆盖：
- **恢复句覆盖** → 移除异常 segment（排除有意 fine edit）
- **切点静音** → 扩展相邻 segment 覆盖静音

不自动修复（报告给用户）：
- **手动删除未生效** → 需要人工确认精确删除范围
- **大段删除衔接** → 需要人耳判断

### A3: 重剪并验证

修复后重新执行 cut_audio.py 和 trim_silences.py，然后再跑一次 audit_cut.js 确认所有问题已清除。

### A4: 生成审听指南

质检通过后，生成一份简洁的审听指南给用户，包括：
- 大段删除的时间戳和前后文（让用户听衔接）
- 之前报告过的 bug 的时间戳（让用户确认修复）
- 新增手动删除的时间戳
- 恢复句的时间戳（确认保留完整）

按时间顺序排列，标注大致的输出音频时间（可用删除段总时长估算偏移），方便用户跳着听。

---

## Phase B: 信号层质检

在 Phase A 通过、音频重新剪辑后运行。直接分析输出音频的信号质量。

### B1: Layer 1 — 信号分析

```bash
python3 <skill_dir>/scripts/signal_analysis.py \
  --input <音频路径> \
  --output <output_dir>/2_分析/qa_signal_report.json
```

自动检测剪切点，运行 5 项检测（能量突变、不自然静音、波形不连续、频谱跳变、呼吸音截断）。

**播客模式优化**（在 report_generator 中自动应用）：
- energy_jump：播客中全是假阳性（自然语气/说话人切换），忽略
- zcr_discontinuity / breath_truncation：播客中误报太多，忽略
- 只保留 spectral_jump 和 unnatural_silence

### B2: Layer 2 — AI 听感评估（可选）

```bash
# 需要 GEMINI_API_KEY（环境变量或 .env 文件）
python3 <skill_dir>/scripts/ai_listen.py \
  --input <音频路径> \
  --signal-report <output_dir>/2_分析/qa_signal_report.json \
  --output <output_dir>/2_分析/qa_ai_report.json
```

两种采样策略：
- **全局采样**：等间隔抽取 6 个 30s 片段，评估整体节奏和风格一致性
- **可疑片段复查**：对 Layer 1 标记的 HIGH 问题做 AI 二次确认（减少误报）

### B3: Layer 3 — 综合报告

```bash
python3 <skill_dir>/scripts/report_generator.py \
  --signal <output_dir>/2_分析/qa_signal_report.json \
  --ai <output_dir>/2_分析/qa_ai_report.json \
  --output <output_dir>/2_分析/qa_report.json \
  --summary <output_dir>/2_分析/qa_summary.md
```

合并 Layer 1 和 Layer 2 的结果，生成综合评分和人类可读摘要。

---

## 完整流程

```
0. 询问用户：output 目录 + 音频路径
    ↓
1. Phase A: 数据层质检
   a. audit_cut.js → 检查 delete_segments
   b. auto_fix.js → 自动修复可修复的问题
   c. 重剪音频（如有修复）
   d. 再跑一次 audit_cut.js 确认通过
    ↓
2. Phase B: 信号层质检
   a. signal_analysis.py → 检测剪切点信号问题
   b. ai_listen.py → AI 听感评估（可选）
   c. report_generator.py → 生成综合报告
    ↓
3. 向用户展示摘要
   - Phase A 残留问题（手动删除未生效 等）
   - Phase B 需复听片段（频谱跳变 等）
   - 大段删除衔接审查点
    ↓
完成
```

---

## 输入输出

**Phase A 输入（自动从 output_dir 读取）：**
- `2_分析/delete_segments_edited.json`（或 `delete_segments.json`）
- `2_分析/fine_analysis.json`
- `2_分析/sentences.txt`
- `2_分析/segment_corrections.json`（如有）
- `2_分析/ai_feedback_*.json`（如有）
- `1_转录/subtitles_words.json`

**Phase B 输入：**
- 剪辑后的播客音频（MP3 / WAV / M4A）
- （可选）Gemini API Key（环境变量 `GEMINI_API_KEY`）

**输出：**
- `2_分析/audit_report.json` — Phase A 数据层质检报告
- `2_分析/qa_signal_report.json` — Layer 1 信号分析报告
- `2_分析/qa_ai_report.json` — Layer 2 AI 评估报告（可选）
- `2_分析/qa_report.json` — 综合报告（JSON）
- `2_分析/qa_summary.md` — 综合报告（Markdown 摘要）

---

## 进度 TodoList

启动时创建：

```
- [ ] 询问用户：output 目录 + 音频路径
- [ ] Phase A: 数据层质检 (audit_cut.js)
- [ ] Phase A: 自动修复 (auto_fix.js)
- [ ] Phase A: 重剪验证（如需要）
- [ ] Phase B: Layer 1 信号分析
- [ ] Phase B: Layer 2 AI 听感评估（可选）
- [ ] Phase B: Layer 3 综合报告
- [ ] 向用户展示摘要
```

---

## 常见问题模式

根据实际使用积累的经验：

### Phase A 常见问题

| 问题模式 | 根因 | 自动修复？ |
|---------|------|-----------|
| 恢复句仍被剪（非 fine edit） | 旧 HTML 导出遗留或跨句 segment | ✅ 移除异常 segment |
| 恢复句内 fine edit 被误移除 | 批量修复太激进（现已通过 edit 匹配避免） | — 不再发生 |
| 删除后出现异常停顿 | 原始录音自然静音被暴露 | ✅ 扩展 segment 消除 |
| 手动整句删除未生效 | pipeline 未为该句生成 segment | ❌ 需人工确认范围 |
| 大段删除衔接不自然 | 删除跨话题/上下文断裂 | ❌ 需人耳判断 |

### Phase B 常见问题

| 问题模式 | 根因 | 解决 |
|---------|------|------|
| energy_jump 全是假阳性 | 播客中自然语气/说话人切换 | 播客模式自动忽略 |
| spectral_jump | 剪切点前后背景噪声变化 | 需人工复听确认 |
| unnatural_silence | 剪切产生的过短/过长静音 | 调整剪切范围 |

---

## 经验与陷阱

### 陷阱 1：播客场景下 energy_jump 全是假阳性

**现象**：信号分析在 56 分钟播客上检出 1725 个 issues（score 1.0/10），其中绝大多数是 energy_jump。

**原因**：播客中自然的说话人切换、语气变化都会产生巨大的能量比（10x-105x 都是正常的）。AI 复查确认 top 10 极端 energy_jump（105x, 78x, 72x…）**全部是假阳性**。

**解决**：播客模式下完全忽略 energy_jump，只保留 spectral_jump 和 unnatural_silence。过滤后从 800 个 → 1 个，复听从 394 → 9 个。

### 陷阱 2：Gemini 模型名需要用最新版

**现象**：`gemini-2.0-flash` 返回 404 错误。

**解决**：使用 `gemini-2.5-flash`。模型更新频繁，如果遇到 404，用 `client.models.list()` 查看可用模型。

### 陷阱 3：Check 1 恢复句误报——有意的 fine edit

**现象**：Check 1 报告恢复句被 segment 覆盖，但其实是用户有意保留的口吃/填充词删除。

**解决**：audit_cut.js 使用 fine_analysis edit 匹配逻辑，如果 segment 与某个 fine edit 有显著重叠（>50% 或 >0.3s），视为有意的 fine edit 而不报告。

### 陷阱 4：API Key 从 .env 自动加载

`ai_listen.py` 会自动从项目根目录的 `.env` 文件读取 `GEMINI_API_KEY`，无需手动 export。

---

## 依赖

```txt
# Phase A (Node.js)
node >= 16

# Phase B (Python)
librosa>=0.10.0
numpy>=1.24.0
soundfile>=0.12.0
google-genai>=1.0.0    # 可选，Layer 2 需要
```

安装：
```bash
pip install librosa numpy soundfile
pip install google-genai          # 可选，启用 AI 听感评估
```

---

## 实际运行数据（2026-02-22）

| 指标 | 数值 |
|------|------|
| 音频 | podcast_final.mp3 (56:32) |
| Layer 1 原始 issues | 1725 |
| 播客模式过滤后 | 1 (spectral_jump) |
| Layer 2 AI 评分 | 7.3/10 |
| AI 复查误报率 | 100%（10/10 全部假阳性） |
| 综合评分 | 8.3/10 |
| 需复听片段 | 9 个（约 45 秒） |
| Gemini 模型 | gemini-2.5-flash |
| API 调用 | 16 次（6 全局 + 10 可疑复查） |

---

## 与其他 Skill 的关系

```
/podcastcut-content     → 内容剪辑
/podcastcut-edit        → 执行剪辑
/podcastcut-质检        → 剪辑质检 ← 本 Skill（Phase A + Phase B）
/podcastcut-后期        → 最终润色
```

**推荐流程：**

```
原始音频/视频
    ↓
/podcastcut-content     ← 删除废话、跑题、隐私
    ↓
/podcastcut-edit        ← 执行剪辑，输出精剪版
    ↓
/podcastcut-质检        ← Phase A 数据层 → 修复 → Phase B 信号层
    ↓
（人工复听标记片段，必要时调整）
    ↓
/podcastcut-后期        ← 片头预览 + 背景音乐 + 时间戳 + 标题 + 简介
    ↓
发布
```

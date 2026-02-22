---
name: podcastcut:质检
description: 播客剪辑质量检测。自动分析剪切点的能量突变、静音异常、频谱跳变，输出质量报告并标记需要人工复听的片段。触发词：质检、检查剪辑、QA、check edit
---

<!--
input: 剪辑后的播客音频
output: QA 报告（JSON + 可读摘要）
pos: 在 /podcastcut-edit 之后使用

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. ../安装/SKILL.md 的 symlink 注册
-->

# 播客剪辑质检

> 自动检测剪辑问题 → 标记可疑片段 → 只听几个标记点，不用从头听到尾

---

## ⚠️ 启动时必须询问

**在开始质检之前，必须先询问用户：**

```
请提供以下信息：

1. **剪辑后的播客音频路径**
   - 例如：`output/2026-02-21_播客名/3_成品/podcast_精剪版.mp3`

2. **（可选）Gemini API Key**
   - 如果已配置环境变量 GEMINI_API_KEY，会自动启用 AI 听感评估
   - 没有也没关系，信号层分析已能检出大多数问题
```

---

## 架构

```
┌─────────────────────────────────────────────────┐
│              播客剪辑质检                         │
│                                                  │
│  输入: 剪辑后音频                                 │
│                                                  │
│  ┌───────────────┐    ┌───────────────────────┐  │
│  │  Layer 1      │    │  Layer 2              │  │
│  │  信号分析      │    │  AI 听感评估           │  │
│  │  (librosa)    │    │  (Gemini Audio API)   │  │
│  │               │    │                       │  │
│  │  - 能量突变    │    │  - 停顿自然度          │  │
│  │  - 静音异常    │    │  - 过渡平滑度          │  │
│  │  - 波形不连续  │    │  - 整体节奏感          │  │
│  │  - 频谱跳变    │    │  - 语义连贯性          │  │
│  │  - 呼吸音截断  │    │                       │  │
│  └───────┬───────┘    └──────────┬────────────┘  │
│          │                       │               │
│          └───────────┬───────────┘               │
│                      ▼                           │
│          ┌───────────────────────┐               │
│          │  Layer 3              │               │
│          │  报告生成              │               │
│          │                       │               │
│          │  - 综合质量评分        │               │
│          │  - 问题片段时间戳      │               │
│          │  - 问题类型分类        │               │
│          │  - 建议修复方式        │               │
│          └───────────────────────┘               │
│                                                  │
│  输出: QA Report (JSON + Markdown 摘要)           │
└─────────────────────────────────────────────────┘
```

**设计原则**：Layer 1 独立可用，无需任何 API Key 即可提供 80% 的价值。Layer 2 是锦上添花。

---

## 快速使用

```
用户: 帮我检查一下剪辑质量
用户: 质检这个播客
用户: QA 我的播客
用户: check edit
```

## 输入

- 剪辑后的播客音频（MP3 / WAV / M4A）
- （可选）Gemini API Key（环境变量 `GEMINI_API_KEY`）

## 输出

1. **QA 报告 JSON** — 结构化数据，给程序用
2. **QA 摘要** — 人类可读的 Markdown，标注需要复听的片段
3. **总体评分** — 1-10 分

---

## 流程

```
0. 询问用户：音频路径
    ↓
1. Layer 1: 信号分析（自动检测剪切点 + 5 项检测）
    ↓
2. Layer 2:（可选）AI 听感评估（Gemini 评估可疑片段）
    ↓
3. Layer 3: 生成综合报告
    ↓
4. 向用户展示摘要，标注需要人工复听的片段
    ↓
完成
```

---

## 一、Layer 1: 信号分析

### 剪切点自动检测

不依赖上游数据，直接从音频中检测剪辑痕迹：

```python
# 自动检测策略：
# 1. 能量包络突变检测 — 短时 RMS 能量的急剧变化
# 2. 静音段边界检测 — 静音段前后是潜在的剪切点
# 3. 频谱不连续检测 — MFCC 特征的突变点
```

### 5 项检测

| # | 检测项 | 方法 | 判定阈值 | 严重度 |
|---|--------|------|----------|--------|
| 1 | 能量突变 | 剪切点前后 100ms 窗口的 RMS 能量比 | ratio > 3.0 | high |
| 2 | 不自然静音 | 静音段过短(<100ms)或过长(>2s) | 基于上下文动态调整 | medium |
| 3 | 波形不连续 | 剪切点的零交叉率(ZCR)突变 | ZCR 变化 > 2 标准差 | medium |
| 4 | 频谱跳变 | 剪切点前后的 MFCC 余弦相似度 | similarity < 0.7 | high |
| 5 | 呼吸音截断 | 检测剪切点是否落在呼吸音中间 | 能量包络模式匹配 | low |

### 运行命令

```bash
python3 "$SKILL_DIR/质检/scripts/signal_analysis.py" \
  --input "$WORK_DIR/podcast_精剪版.mp3" \
  --output "$WORK_DIR/qa_signal_report.json"
```

### 输出格式

```json
{
  "audio_file": "podcast_精剪版.mp3",
  "duration_seconds": 5400,
  "detected_cut_points": 42,
  "issues": [
    {
      "timestamp": 45.23,
      "type": "energy_jump",
      "severity": "high",
      "detail": "Energy ratio 5.2x at cut point",
      "suggestion": "Add 50ms crossfade",
      "listen_range": [43.0, 48.0]
    },
    {
      "timestamp": 123.45,
      "type": "unnatural_silence",
      "severity": "medium",
      "detail": "Silence duration 50ms between sentences (expected 300-500ms)",
      "suggestion": "Extend silence to 300ms",
      "listen_range": [121.0, 126.0]
    }
  ],
  "signal_score": 8.2,
  "summary": {
    "total_issues": 3,
    "high": 1,
    "medium": 1,
    "low": 1
  }
}
```

---

## 二、Layer 2: AI 听感评估（可选）

使用 Gemini 的原生音频理解能力评估人耳层面的听感。需要 `GEMINI_API_KEY` 环境变量。

### 评估策略

不是把整集扔给 Gemini（太贵），而是有针对性地评估：

| 策略 | 说明 | 片段时长 |
|------|------|----------|
| 全局采样 | 等间隔抽取 5-8 个片段，评估整体节奏和风格一致性 | 30 秒/个 |
| 可疑片段复查 | 对 Layer 1 标记的问题片段，用 AI 二次确认（减少误报） | 10 秒/个 |

### Gemini Prompt

```
You are a professional podcast editor evaluating an audio edit.
Listen carefully to this clip and evaluate:

1. TRANSITION QUALITY (1-10): Does the edit point sound natural?
   - Is there an abrupt change in background noise or room tone?
   - Does the speaker's intonation flow naturally across the edit?
   - Are pauses between sentences/words at a natural duration?

2. SPECIFIC ISSUES: List any moments that sound "off" with timestamps.

3. VERDICT: "pass" / "review_recommended" / "redo_recommended"

Be precise with timestamps. A professional listener would catch these issues.
```

### 成本预估

| 播客时长 | API 调用次数 | 预估成本 |
|----------|-------------|----------|
| 30 分钟 | 20-30 次 | $0.10-0.30 |
| 60 分钟 | 30-50 次 | $0.20-0.50 |
| 90 分钟 | 40-60 次 | $0.30-0.60 |

### 运行命令

```bash
# 需要设置环境变量
export GEMINI_API_KEY="your-api-key"

python3 "$SKILL_DIR/质检/scripts/ai_listen.py" \
  --input "$WORK_DIR/podcast_精剪版.mp3" \
  --signal-report "$WORK_DIR/qa_signal_report.json" \
  --output "$WORK_DIR/qa_ai_report.json"
```

---

## 三、Layer 3: 综合报告

合并 Layer 1 和 Layer 2 的结果，生成人类可快速浏览的 QA 报告。

### 报告内容

| 部分 | 说明 |
|------|------|
| 总体评分 | 综合 signal_score 和 AI 评分，1-10 |
| 需要复听的片段 | 按严重程度排序，带时间戳 |
| 自动通过的片段 | 两层都没问题，标为 PASS |
| 统计摘要 | 总剪切数、问题率、各类问题分布 |

### 运行命令

```bash
python3 "$SKILL_DIR/质检/scripts/report_generator.py" \
  --signal "$WORK_DIR/qa_signal_report.json" \
  --ai "$WORK_DIR/qa_ai_report.json" \
  --output "$WORK_DIR/qa_report.json" \
  --summary "$WORK_DIR/qa_summary.md"
```

### 摘要示例

```markdown
# 播客剪辑质检报告

**音频**: podcast_精剪版.mp3
**时长**: 1:30:00
**检测剪切点**: 42 个
**总体评分**: 8.2 / 10

## 需要人工复听的片段（3 个）

| # | 时间 | 问题类型 | 严重度 | 说明 |
|---|------|----------|--------|------|
| 1 | 00:45 | 能量突变 | HIGH | 能量比 5.2x，建议加 50ms 交叉淡化 |
| 2 | 02:03 | 不自然静音 | MEDIUM | 句间静音仅 50ms，建议延长到 300ms |
| 3 | 15:22 | 频谱跳变 | MEDIUM | 背景噪声在剪切点突变 |

## 统计

- HIGH: 1 个
- MEDIUM: 2 个
- LOW: 0 个
- 自动通过: 39 个（92.9%）

> 只需复听以上 3 个片段（约 15 秒），无需听完整集。
```

---

## 进度 TodoList

启动时创建：

```
- [ ] 询问用户：音频路径
- [ ] Layer 1: 信号分析（检测剪切点 + 5 项检测）
- [ ] Layer 2:（可选）AI 听感评估
- [ ] Layer 3: 生成综合报告
- [ ] 向用户展示摘要
```

---

## 输出文件

```
qa_signal_report.json         # Layer 1 信号分析结果
qa_ai_report.json             # Layer 2 AI 评估结果（可选）
qa_report.json                # 综合报告（JSON）
qa_summary.md                 # 综合报告（Markdown 摘要）
```

---

## 与其他 Skill 的关系

```
/podcastcut-content     → 内容剪辑
/podcastcut-edit        → 执行剪辑
/podcastcut-质检        → 剪辑质检 ← 本 Skill
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
/podcastcut-质检        ← 自动检测剪辑问题，标记复听点
    ↓
（人工复听标记片段，必要时调整）
    ↓
/podcastcut-后期        ← 片头预览 + 背景音乐 + 时间戳 + 标题 + 简介
    ↓
发布
```

---

## 经验与陷阱

### 陷阱 1：播客场景下 energy_jump 全是假阳性

**现象**：信号分析在 56 分钟播客上检出 1725 个 issues（score 1.0/10），其中绝大多数是 energy_jump。

**原因**：播客中自然的说话人切换、语气变化都会产生巨大的能量比（10x-105x 都是正常的）。AI 复查确认 top 10 极端 energy_jump（105x, 78x, 72x…）**全部是假阳性**。

**解决**：播客模式下完全忽略 energy_jump，只保留 spectral_jump（频谱跳变）和 unnatural_silence（不自然静音）。过滤后从 800 个 → 1 个，复听从 394 → 9 个。

### 陷阱 2：Gemini 模型名需要用最新版

**现象**：`gemini-2.0-flash` 返回 404 错误。

**解决**：使用 `gemini-2.5-flash`。模型更新频繁，如果遇到 404，用 `client.models.list()` 查看可用模型。

### 陷阱 3：API Key 从 .env 自动加载

`ai_listen.py` 会自动从项目根目录的 `.env` 文件读取 `GEMINI_API_KEY`，无需手动 export。

---

## 依赖

```txt
# requirements.txt
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

## 示例对话

```
用户: 帮我质检一下剪辑后的播客

AI: 好的，请提供剪辑后的播客音频路径。

用户: output/2026-02-21_聊天/3_成品/podcast_精剪版.mp3

AI: 收到！开始质检...

    Layer 1: 信号分析
    ✓ 检测到 42 个剪切点
    ✓ 5 项检测完成

    Layer 2: AI 听感评估
    ⓘ 未配置 GEMINI_API_KEY，跳过（仅使用信号分析结果）

    ## 质检报告

    **总体评分: 8.2 / 10**

    ### 需要人工复听的片段（3 个）

    | # | 时间 | 问题 | 严重度 |
    |---|------|------|--------|
    | 1 | 00:45 | 能量突变 5.2x | HIGH |
    | 2 | 02:03 | 静音过短 50ms | MEDIUM |
    | 3 | 15:22 | 频谱跳变 | MEDIUM |

    只需复听以上 3 个片段（约 15 秒），无需听完整集。

    报告已保存：
    - qa_report.json
    - qa_summary.md
```

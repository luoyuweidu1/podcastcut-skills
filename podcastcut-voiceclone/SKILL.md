---
name: podcastcut-voiceclone
description: 声音克隆播客剪辑。ASR转录 → AI修正文字 → 声音克隆TTS重新生成干净音频。触发词：声音克隆、voiceclone、重新生成
---

# 声音克隆播客剪辑

> 原始音频 → ASR转录 → AI修正文字 → 提取说话人样本 → 声音克隆 → TTS重新生成

## 快速使用

```
用户: 用声音克隆重新生成播客
用户: voiceclone
用户: 帮我用 TTS 重新生成这段播客音频
```

## 核心思路

传统剪辑思路是"剪掉不要的"（删寒暄、口误、语气词），需要复杂的时间戳对齐和 FFmpeg 剪辑。

新思路是"重新生成"：用 ASR 获取文字 → AI 修正文字 → 声音克隆 → TTS 重新生成干净音频。直接输出完美音频，无需处理时间戳对齐。

## 输入

- 原始音频文件
- `podcast_transcript.json`（ASR 转录结果，已有则跳过转录）
- （可选）说话人名字列表

## 输出

- `podcast_修正稿.json` — 修正后的逐字稿
- `speaker_*_sample.wav` — 说话人音频样本
- `voice_models.json` — speaker→model_id 映射
- `segment_*.mp3` — 各段 TTS 音频
- `podcast_voiceclone.mp3` — 最终合并音频

## 依赖

- `FISH_API_KEY` in `.env`（Fish Audio API 密钥）
- `requests`、`python-dotenv`（pip install）
- FFmpeg（音频提取和合并）

---

## 流程

```
原始音频
    ↓
1. ASR 转录（已有 podcast_transcript.json 则跳过）
    ↓
2. Claude 审阅逐字稿，修正：
   - 语法错误、逻辑不通
   - 语塞/口误/重复（直接删除或改写）
   - 阿拉伯数字 → 汉字
   - 去掉废话/寒暄
   → 输出 podcast_修正稿.json
    ↓
3. 提取每个说话人 ~20s 的独说片段（FFmpeg）
   python scripts/extract_speaker_samples.py <transcript.json> <音频文件> <输出目录>
    ↓
4. 上传 Fish Audio 创建声音模型
   python scripts/create_voice_model.py <样本目录> <speaker名字映射JSON>
    ↓
5. 逐段用 TTS 重新生成音频
   python scripts/tts_generate.py <修正稿.json> <voice_models.json> <输出目录>
    ↓
6. 合并所有段落 → 最终音频
   python scripts/merge_segments.py <segment目录> <输出文件>
```

---

## 步骤详解

### 步骤 1: ASR 转录

如果已有 `podcast_transcript.json`，跳过此步。否则调用 `/podcastcut-content` 的转录脚本：

```bash
python ~/.claude/skills/podcastcut-content/scripts/transcribe.py <音频文件> <输出目录>
```

### 步骤 2: Claude 审阅修正

**这是人工步骤**。Claude 读取 `podcast_逐字稿.md`（或从 transcript JSON 生成），进行以下修正：

- 语法错误、逻辑不通 → 改写通顺
- 语塞/口误/重复 → 直接删除或改写
- 阿拉伯数字 → 汉字（如 "70岁" → "七十岁"）
- 废话/寒暄 → 删除
- ASR 识别错误 → 修正

**输出格式** `podcast_修正稿.json`：

```json
{
  "segments": [
    {"speaker": "xujia", "text": "修正后的文字"},
    {"speaker": "嘉宾女", "text": "修正后的文字"}
  ]
}
```

### 步骤 3: 提取说话人音频样本

```bash
python scripts/extract_speaker_samples.py podcast_transcript.json 4-1.WAV ./samples
```

- 读取 transcript JSON，按 spk 分组
- 找每个 speaker 连续说话最长的片段（目标 ~20s）
- 用 FFmpeg `atrim` 提取音频片段
- 输出 `speaker_0_sample.wav`, `speaker_1_sample.wav` 等

### 步骤 4: 创建声音模型

```bash
python scripts/create_voice_model.py ./samples '{"0":"xujia","1":"嘉宾女","2":"嘉宾男"}'
```

- 读取 `.env` 中的 `FISH_API_KEY`
- 对每个说话人样本，POST 到 Fish Audio 创建模型
- 输出 `voice_models.json`：speaker名 → model_id 映射

### 步骤 5: TTS 生成

```bash
python scripts/tts_generate.py podcast_修正稿.json voice_models.json ./tts_output
```

- 逐段读取修正后的文本
- 用对应 speaker 的 model_id 调用 Fish Audio TTS
- 保存每段音频文件 `segment_001.mp3`, `segment_002.mp3`, ...

### 步骤 6: 合并音频

```bash
python scripts/merge_segments.py ./tts_output podcast_voiceclone.mp3
```

- 用 FFmpeg concat demuxer 合并所有 segment
- 输出 `podcast_voiceclone.mp3`

---

## Fish Audio API

### 创建声音模型

```
POST https://api.fish.audio/model
Content-Type: multipart/form-data
Authorization: Bearer {FISH_API_KEY}

Fields:
  - voices: 音频文件（WAV）
  - type: "tts"
  - title: 说话人名字
  - train_mode: "fast"
  - visibility: "private"

Response: {"_id": "model_id", ...}
```

### TTS 生成

```
POST https://api.fish.audio/v1/tts
Authorization: Bearer {FISH_API_KEY}
Content-Type: application/json

Headers:
  - model: "speech-1.6"

Body:
{
  "text": "要生成的文字",
  "reference_id": "model_id"
}

Response: 音频二进制数据（MP3）
```

---

## 修正稿格式

```json
{
  "segments": [
    {
      "speaker": "xujia",
      "text": "在我爸那边的感觉是，在这边大家很不习惯，吃的不好，也没有那么多朋友或者活动可以参加。"
    },
    {
      "speaker": "嘉宾女",
      "text": "你爸其实还年轻，到七十岁、八十岁的时候，想法可能就又不一样了。这个东西确实需要计划，跟你的计划有关系。"
    }
  ]
}
```

---

## 验证清单

1. 提取的音频样本是否干净（单人说话，~20s）
2. Fish Audio 模型是否创建成功（返回 model_id）
3. TTS 输出音频是否听起来像原始说话人
4. 合并后的音频是否连贯、自然
5. 与原始音频对比，内容是否更干净（无口误、无废话）

---

## 进度 TodoList

启动时创建：

```
- [ ] 确认已有 podcast_transcript.json（或转录）
- [ ] Claude 审阅逐字稿，输出修正稿
- [ ] 提取说话人音频样本
- [ ] 上传 Fish Audio 创建声音模型
- [ ] TTS 逐段生成音频
- [ ] 合并所有段落为最终音频
- [ ] 验证输出质量
```

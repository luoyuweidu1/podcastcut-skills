---
name: podcastcut:音质处理
description: |
  播客音质处理：按说话人单独处理音质。
  响度分析（LUFS）、选择性降噪/去回声（DeepFilterNet）、音乐段检测与保护、全局响度标准化。
  触发词：音质处理、处理音质、降噪、去回声、audio quality
---

<!--
input: 剪辑后成品 MP3 + speaker_mapping.json + subtitles_words.json
output: 音质处理版 MP3（同码率）
pos: 在 /podcastcut-剪播客 阶段 3 之后、/podcastcut-后期 之前

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. ../安装/SKILL.md 的 symlink 注册
3. ../剪播客/SKILL.md 的阶段 4 说明
-->

# 播客音质处理

> 按说话人响度分析 → 选择性降噪/去回声 → 音乐段检测与保护 → 全局响度标准化

---

## 🔴 音质保护红线

1. **不降低码率** — 输出 MP3 码率 ≥ 输入码率（至少 192kbps）
2. **处理前自动备份** — 原文件备份为 `*_pre_audio_fix.mp3`
3. **音乐段不处理** — 自动检测或用户标注的音乐段原样保留
4. **每步可预览** — 用户可以在任一步骤停下来试听效果

---

## ⚠️ 启动时必须询问

```
在开始音质处理之前，请提供以下信息：

1. **播客音频路径**（阶段 3 成品）
   - 例如：`output/.../3_成品/podcast_精剪版_v2_trimmed.mp3`

2. **speaker_mapping.json 路径**
   - 例如：`output/.../1_转录/speaker_mapping.json`

3. **subtitles_words.json 路径**（用于定位说话人时间段）
   - 例如：`output/.../1_转录/subtitles_words.json`

4. **哪些说话人需要降噪/去回声？**
   - 例如："阿司需要去回声，其他人不用"
   - 或 "全部处理"

5. **音频中是否已有音乐段？**
   - 如果已加了片头片尾音乐，请告知大致时间范围
   - 如果还没加音乐（推荐），可以跳过音乐检测
```

---

## 与其他 Skill 的关系

```
阶段 1: 转录 + AI 分析 → 阶段 2: 人工审核 → 阶段 3: 剪辑+质检
    → 阶段 4: 音质处理（本 Skill）
    → 阶段 5: 后期 (/podcastcut-后期)
```

**推荐执行顺序**：先剪辑 → 再处理音质 → 最后加音乐。
这样：(1) 处理更短的音频更快，(2) 音乐段不会被误处理。

---

## 流程

```
0. 询问用户：音频路径 + 说话人映射 + 处理需求
    ↓
1. 响度分析
   → 分析各说话人平均响度（LUFS）
   → 展示报告：谁音量偏小/偏大
    ↓
2. 按说话人降噪/去回声（可选）
   → 用户指定哪些说话人需要处理
   → 按时间段切分 → DeepFilterNet 处理 → 拼回
   → 试听对比：处理前 vs 处理后
    ↓
3. 音乐段检测与保护（如音频含音乐）
   → 频谱分析识别音乐 vs 人声段
   → 标记音乐段，后续处理自动跳过
    ↓
4. 全局响度标准化
   → 按说话人补偿音量差异
   → 整体标准化到 -16 LUFS（播客标准）
    ↓
5. 输出
   → 备份原文件
   → 生成音质处理版 MP3
   → 展示处理摘要
```

---

## 步骤详解

### 步骤 1: 响度分析

```bash
python3 "$SKILL_DIR/音质处理/scripts/analyze_loudness.py" \
  --audio <音频路径> \
  --words <subtitles_words.json> \
  --speaker-mapping <speaker_mapping.json> \
  --output <output_dir>/loudness_report.json
```

**输出**：
```json
{
  "overall_lufs": -20.3,
  "target_lufs": -16.0,
  "speakers": {
    "阿司": { "lufs": -23.1, "segments_count": 45, "total_duration": "18:32", "needs_boost": true, "boost_db": 3.1 },
    "雨林": { "lufs": -25.2, "segments_count": 38, "total_duration": "15:10", "needs_boost": true, "boost_db": 5.2 },
    "潘潘": { "lufs": -19.8, "segments_count": 52, "total_duration": "22:45", "needs_boost": false, "boost_db": 0 }
  }
}
```

**展示给用户**：
```
响度分析结果：

| 说话人 | 平均响度 | 时长 | 偏差 | 需要调整 |
|--------|---------|------|------|---------|
| 阿司   | -23.1 LUFS | 18:32 | -3.1 dB | 需要提升 |
| 雨林   | -25.2 LUFS | 15:10 | -5.2 dB | 需要提升 |
| 潘潘   | -19.8 LUFS | 22:45 | +0.2 dB | 正常 |

目标：-16 LUFS（播客标准）

需要对哪些说话人做降噪/去回声处理？
```

### 步骤 2: 按说话人降噪/去回声

```bash
python3 "$SKILL_DIR/音质处理/scripts/process_speaker.py" \
  --audio <音频路径> \
  --words <subtitles_words.json> \
  --speaker-mapping <speaker_mapping.json> \
  --speakers "阿司" \
  --method deepfilternet \
  --output <output_dir>/audio_denoised.mp3 \
  --bitrate 192k
```

**工作原理**：
1. 从 `subtitles_words.json` 提取指定说话人的所有时间段
2. 合并相邻段（gap < 0.5s）避免切割过碎
3. 对每段单独跑 DeepFilterNet
4. 将处理后的段落替换回原音频（非处理段原样保留）
5. 输出处理后的完整音频

**关键约束**：
- 只处理用户指定的说话人
- 非指定说话人的段落一个字节都不动
- 段落之间的间隙（多人同时说话除外）不处理
- 如有音乐段标记，自动跳过

**试听对比**：
处理完成后，自动截取 3 段处理前后的对比片段（每段 10-15 秒），提示用户试听：
```
已处理完成！以下是处理前后对比片段：

| 片段 | 时间 | 说话人 | 处理前 | 处理后 |
|------|------|--------|--------|--------|
| 1 | 3:22-3:37 | 阿司 | preview_before_1.mp3 | preview_after_1.mp3 |
| 2 | 15:08-15:22 | 阿司 | preview_before_2.mp3 | preview_after_2.mp3 |
| 3 | 28:45-28:58 | 阿司 | preview_before_3.mp3 | preview_after_3.mp3 |

请试听后告诉我效果如何。如果满意，继续下一步；如果需要调整，可以更换处理方法。
```

### 步骤 3: 音乐段检测（如需要）

```bash
python3 "$SKILL_DIR/音质处理/scripts/detect_music.py" \
  --audio <音频路径> \
  --output <output_dir>/music_segments.json
```

基于频谱特征区分人声和音乐：
- 音乐段：频谱能量分布均匀、周期性强、缺乏语音 formant
- 人声段：清晰的 formant 结构、能量集中在 300-3000Hz

**输出**：
```json
{
  "music_segments": [
    { "start": 0.0, "end": 15.2, "confidence": 0.95, "type": "intro_music" },
    { "start": 2845.0, "end": 2860.5, "confidence": 0.92, "type": "outro_music" }
  ]
}
```

如果用户已告知音乐段位置，直接使用用户标注，跳过自动检测。

### 步骤 4: 全局响度标准化

```bash
python3 "$SKILL_DIR/音质处理/scripts/normalize_loudness.py" \
  --audio <上一步输出的音频> \
  --loudness-report <output_dir>/loudness_report.json \
  --music-segments <output_dir>/music_segments.json \
  --target-lufs -16 \
  --output <最终输出路径> \
  --bitrate 192k
```

**处理逻辑**：
1. 按说话人时间段应用各自的增益补偿（来自响度报告）
2. 音乐段应用整体增益（不按说话人）
3. 全局 limiter 防止削波（peak -1 dBTP）
4. 最终输出标准化到 -16 LUFS

---

## 输入输出

**输入**：
- 剪辑后成品 MP3（阶段 3 输出）
- `speaker_mapping.json`（说话人名字映射）
- `subtitles_words.json`（词级时间戳，用于定位说话人段落）

**输出**：
- `*_audio_processed.mp3` — 音质处理后的成品
- `*_pre_audio_fix.mp3` — 处理前备份
- `loudness_report.json` — 响度分析报告
- `music_segments.json` — 音乐段标记（如有）

---

## 依赖

```bash
# DeepFilterNet（降噪/去回声）
pip install deepfilternet

# 响度分析和标准化
pip install pyloudnorm soundfile numpy

# 音乐检测
pip install librosa
```

---

## 常见问题

### DeepFilterNet 把音乐删了
**原因**：DeepFilterNet 把音乐识别为噪声并替换为静音。
**解决**：先检测音乐段 → 处理时跳过。或者推荐在加音乐之前做音质处理。

### 处理后人声听起来有金属感
**原因**：DeepFilterNet 对干净音频过度处理。
**解决**：只对需要处理的说话人开启，不要全局处理。

### 处理后片段衔接处有突变
**原因**：处理段和非处理段的音质/音色差异。
**解决**：在衔接处做 50ms crossfade 过渡。

---

## 进度 TodoList

启动时创建：

```
- [ ] 询问用户：音频路径 + 说话人映射 + 处理需求
- [ ] 步骤 1: 响度分析
- [ ] 步骤 2: 按说话人降噪/去回声（可选）
- [ ] 步骤 2: 试听对比
- [ ] 步骤 3: 音乐段检测（如需要）
- [ ] 步骤 4: 全局响度标准化
- [ ] 输出最终文件 + 展示摘要
```

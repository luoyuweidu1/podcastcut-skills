---
name: podcastcut-final-touch
description: 播客最终润色。高亮片段预览、片头背景音乐、时间戳章节、标题建议、播客简介。触发词：最终润色、final touch、加片头、生成时间戳
---

# 播客最终润色

> 高亮片段 → 片头预览 → 主题曲片头片尾 → 时间戳章节 → 标题 + 简介

---

## 五点一刻专属配置

### 主题曲

| 配置 | 值 |
|------|-----|
| 歌曲 | Surfaces - Sunny Side Up |
| 路径 | `/Users/xiangli/Music/Music/Media.localized/Music/Unknown Artist/Unknown Album/Surfaces - Sunny Side Up (Official Audio).mp3` |
| 总时长 | 2:51 |

### 片头片尾规则

| 位置 | 时长 | 效果 |
|------|------|------|
| 片头 | ~15秒 | 主题曲渐入 → 人声开始时渐出 |
| 片尾 | ~15秒 | 人声结束后 → 主题曲渐入 → 渐出结束 |

### 参考

已剪辑好的示例：`~/Downloads/五点一刻｜E04-Maia&响歌歌-第四版（最终版）.MP3`

## 快速使用

```
用户: 帮我做播客的最终润色
用户: 加个片头预览
用户: 生成时间戳章节
用户: final touch
```

## 输入

- 已剪辑好的播客音频/视频（通常是 `/podcastcut-edit` 输出的版本）
- （可选）逐字稿或转录JSON
- （可选）片头背景音乐文件

## 输出

1. **片头预览** - 3-4个高亮片段拼接到片头
2. **带背景音乐的片头** - 预览片段配上背景音乐
3. **时间戳章节** - 适合YouTube/播客平台的章节列表
4. **标题建议** - 3-5个标题选项
5. **播客简介** - 适合发布的简介文案

---

## 流程

```
1. 分析内容，推荐高亮片段
    ↓
【用户选择 3-4 个片段】
    ↓
2. 提取片段 + 拼接片头预览
    ↓
3. 添加主题曲片头（~15秒，渐入渐出）
    ↓
4. 添加主题曲片尾（~15秒，渐入渐出）
    ↓
5. 分析话题结构，生成时间戳章节
    ↓
6. 生成标题建议
    ↓
7. 生成播客简介
    ↓
完成
```

---

## 一、高亮片段推荐

### 什么是好的高亮片段

| 特征 | 说明 |
|------|------|
| 金句 | 有力、简洁、有记忆点的表达 |
| 观点碰撞 | 不同意见的精彩交锋 |
| 情绪高点 | 笑声、感叹、惊讶的时刻 |
| 悬念/钩子 | 让听众想继续听下去的内容 |
| 核心洞察 | 播客最有价值的观点浓缩 |

### 推荐格式

```markdown
## 推荐高亮片段

我从播客中识别了以下精彩片段，请选择 3-4 个作为片头预览：

| # | 时间 | 说话人 | 内容摘要 | 推荐理由 |
|---|------|--------|----------|----------|
| 1 | 15:32-15:58 | 响歌歌 | "工作的意义不是..." | 金句，核心观点 |
| 2 | 32:45-33:12 | Maia | "我当时就觉得不对劲..." | 故事性强，有悬念 |
| 3 | 48:20-48:45 | 安安 | "这完全是两回事..." | 观点碰撞 |
| 4 | 1:05:30-1:06:00 | 响歌歌 | [笑] "你这个比喻太绝了" | 情绪高点 |
| 5 | 1:18:22-1:18:50 | Maia | "如果重新选择..." | 引发思考 |

请回复选择的编号，如：`1, 3, 4` 或 `选 1 3 4`
```

### 识别规则

1. **扫描转录文本**：寻找有力的表达、比喻、反问
2. **检测情绪词**：笑、哇、真的吗、太对了
3. **关注转折点**：但是、其实、说实话、我觉得
4. **识别金句模式**：短句、排比、对比、类比
5. **推荐 5-8 个**，让用户选 3-4 个

---

## 二、片头预览制作

### 预览片段规范

| 规范 | 说明 |
|------|------|
| 数量 | 3-4 个片段 |
| 单片段时长 | 10-30 秒 |
| 总时长 | 30-90 秒 |
| 顺序 | 按精彩程度排列，最吸引人的放第一个 |

### FFmpeg 片段拼接

```bash
# 1. 提取各片段
ffmpeg -i podcast.mp4 -ss 15:32 -to 15:58 -c copy clip1.mp4
ffmpeg -i podcast.mp4 -ss 32:45 -to 33:12 -c copy clip2.mp4
ffmpeg -i podcast.mp4 -ss 48:20 -to 48:45 -c copy clip3.mp4

# 2. 创建片段列表
echo "file 'clip1.mp4'" > clips.txt
echo "file 'clip2.mp4'" >> clips.txt
echo "file 'clip3.mp4'" >> clips.txt

# 3. 拼接片段
ffmpeg -f concat -safe 0 -i clips.txt -c copy preview.mp4
```

### 片段间过渡

| 选项 | 效果 |
|------|------|
| 直切 | 默认，简洁 |
| 黑场过渡 | 0.3-0.5秒黑屏，区分片段 |
| 淡入淡出 | 更柔和，但增加时长 |

---

## 三、主题曲片头片尾

### 结构示意

```
┌─────────────────────────────────────────────────────────────────┐
│  片头主题曲   │  高亮预览  │     正片内容     │  片尾主题曲   │
│   (~15秒)    │  (30-90秒) │                  │   (~15秒)    │
│  渐入→渐出   │            │                  │  渐入→渐出   │
└─────────────────────────────────────────────────────────────────┘
```

### 片头处理

| 参数 | 值 |
|------|-----|
| 时长 | 约 15 秒 |
| 渐入 | 0-2秒，从静音渐入到正常音量 |
| 渐出 | 最后 3 秒，渐出到静音（与人声衔接） |
| 音量 | 正常播放音量 |

```bash
# 1. 提取主题曲片头（15秒）
THEME_SONG="/Users/xiangli/Music/Music/Media.localized/Music/Unknown Artist/Unknown Album/Surfaces - Sunny Side Up (Official Audio).mp3"

ffmpeg -i "$THEME_SONG" -t 15 \
  -af "afade=t=in:d=2,afade=t=out:st=12:d=3" \
  intro_music.mp3

# 2. 拼接：片头音乐 + 预览 + 正片
ffmpeg -i intro_music.mp3 -i preview_and_main.mp3 \
  -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[outa]" \
  -map "[outa]" output_with_intro.mp3
```

### 片尾处理

| 参数 | 值 |
|------|-----|
| 时长 | 约 15 秒 |
| 渐入 | 0-3秒，从静音渐入（与人声衔接） |
| 渐出 | 最后 2 秒，渐出到静音 |
| 音量 | 正常播放音量 |

```bash
# 1. 提取主题曲片尾（15秒，可以从歌曲不同位置截取）
ffmpeg -i "$THEME_SONG" -ss 30 -t 15 \
  -af "afade=t=in:d=3,afade=t=out:st=13:d=2" \
  outro_music.mp3

# 2. 拼接：正片 + 片尾音乐
ffmpeg -i main_content.mp3 -i outro_music.mp3 \
  -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[outa]" \
  -map "[outa]" output_with_outro.mp3
```

### 完整拼接命令

```bash
# 一次性拼接：片头 + 预览 + 正片 + 片尾
ffmpeg -i intro_music.mp3 -i preview.mp3 -i main.mp3 -i outro_music.mp3 \
  -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1[outa]" \
  -map "[outa]" -c:a libmp3lame -q:a 2 \
  podcast_final.mp3
```

### 音量调整

如果主题曲太响或太轻，可以调整：

```bash
# 降低音量（0.8 = 80%）
ffmpeg -i intro_music.mp3 -af "volume=0.8" intro_music_adjusted.mp3

# 提高音量（1.2 = 120%）
ffmpeg -i intro_music.mp3 -af "volume=1.2" intro_music_adjusted.mp3
```

---

## 四、时间戳章节生成

### 格式规范

```
00:00 片头预览
01:30 正式开场

02:05 话题一的标题
07:58 话题二的标题
26:16 话题三的标题

1:00:08 话题四的标题
1:23:00 话题五的标题
```

### 格式规则

| 规则 | 说明 |
|------|------|
| 时间格式 | `MM:SS` 或 `H:MM:SS`（超过1小时） |
| 首章 | `00:00 片头预览`（如果有预览） |
| 间隔 | 话题间空行分组（可选） |
| 标题 | 简洁、有信息量，不超过20字 |

### 章节识别规则

1. **话题切换点**：从逐字稿识别主题变化
2. **信号词**：
   - "接下来聊聊..."
   - "说到这个..."
   - "另一个话题是..."
   - "最后聊一下..."
3. **章节粒度**：
   - 30分钟内：3-5 个章节
   - 1小时：5-8 个章节
   - 2小时：8-12 个章节

### 示例

```
00:00 片头精彩预览
01:26 我们为什么要聊"工作的意义"？

02:05 童年记忆：父母那一代的工作观
07:58 学生时代：对"光鲜工作"的幻想与实习体验
26:16 第一份工作：大厂光环、身份焦虑与选择
32:07 留学生求职：为身份而工作 vs 为生活而工作

38:27 钱、意义感与工作生活的平衡
1:00:08 工作的"无意义"时刻：我们在对抗什么？
1:08:17 价值观碰撞：工作到底有没有意义？

1:23:00 建立生活支点：如何不让工作定义自己？
1:32:58 我们是两种人，但都在寻找自己的答案
```

---

## 五、标题建议

### 标题类型

| 类型 | 示例 | 适用场景 |
|------|------|----------|
| 问题型 | "工作的意义是什么？" | 引发思考 |
| 观点型 | "工作不该定义你的人生" | 立场鲜明 |
| 金句型 | "我们都在寻找自己的答案" | 情感共鸣 |
| 话题型 | "聊聊大厂、身份焦虑和选择" | 信息明确 |
| 悬念型 | "那一刻，我决定不再为身份工作" | 吸引点击 |

### 输出格式

```markdown
## 标题建议

1. **工作的意义是什么？三个"打工人"的真实思考**（问题 + 信息）
2. **我们为什么要聊"工作的意义"？**（问题型）
3. **不想让工作定义自己，然后呢？**（悬念型）
4. **大厂光环、身份焦虑、人生选择｜三人真心话**（话题型）
5. **两种人，一个答案：找到你自己的工作观**（金句型）

推荐：第 1 个（信息量足，有吸引力）
```

---

## 六、播客简介

### 简介结构

```markdown
【本期话题】
一句话概括本期内容

【嘉宾/主播】
- 名字：一句话介绍

【时间戳】
（粘贴时间戳章节）

【精彩片段】
- "金句1"
- "金句2"

【关于我们】
固定的播客介绍（用户提供模板）
```

### 示例

```markdown
【本期话题】
工作到底有没有意义？三位背景迥异的朋友，聊聊各自对工作的真实看法。

【主播】
- Maia：前大厂产品经理，现自由职业
- 响歌歌：硅谷工程师，在美十年
- 安安：创业中，曾放弃大厂offer

【时间戳】
00:00 片头精彩预览
01:26 我们为什么要聊"工作的意义"？
02:05 童年记忆：父母那一代的工作观
...

【精彩片段】
- "工作的意义不是找到的，是创造的"
- "我不想让签证定义我的人生选择"
- "你可以是两种人，也可以是第三种"

【收听平台】
小宇宙 / Apple Podcasts / Spotify / 喜马拉雅
```

---

## 进度 TodoList

启动时创建：

```
- [ ] 分析内容，推荐高亮片段（5-8个）
- [ ] 等待用户选择 3-4 个片段
- [ ] 提取并拼接片头预览
- [ ] 添加主题曲片头（~15秒，渐入渐出）
- [ ] 添加主题曲片尾（~15秒，渐入渐出）
- [ ] 生成时间戳章节
- [ ] 生成标题建议
- [ ] 生成播客简介
```

---

## 输出文件

```
podcast_preview.mp3           # 高亮片段预览
podcast_intro.mp3             # 片头主题曲（15秒，渐入渐出）
podcast_outro.mp3             # 片尾主题曲（15秒，渐入渐出）
podcast_final.mp3             # 最终版本（片头 + 预览 + 正片 + 片尾）
podcast_时间戳.txt            # 时间戳章节
podcast_标题建议.txt          # 标题选项
podcast_简介.txt              # 发布简介
```

---

## 与其他 Skill 的关系

```
/podcastcut-content     → 内容剪辑
/podcastcut-edit        → 执行剪辑
/podcastcut-transcribe  → 口误识别
/podcastcut-final-touch → 最终润色 ← 本 Skill
```

**推荐流程：**

```
原始音频/视频
    ↓
/podcastcut-content     ← 删除废话、跑题、隐私
    ↓
/podcastcut-edit        ← 执行剪辑，输出 v2
    ↓
【可选】处理口误
    ↓
/podcastcut-final-touch ← 片头预览 + 背景音乐 + 时间戳 + 标题 + 简介
    ↓
发布
```

---

## 示例对话

```
用户: 帮我做这个播客的 final touch

AI: 好的，我来为这个播客做最终润色。

    首先分析内容，寻找高亮片段...

    ## 推荐高亮片段

    | # | 时间 | 说话人 | 内容 | 推荐理由 |
    |---|------|--------|------|----------|
    | 1 | 15:32 | 响歌歌 | "工作的意义不是找到的，是创造的" | 金句 |
    | 2 | 32:45 | Maia | "那一刻我觉得，签证不该定义我" | 情感共鸣 |
    | 3 | 48:20 | 安安 | "说实话，我拒绝那个offer的时候..." | 故事悬念 |
    | 4 | 1:05:30 | 响歌歌 | [笑] "你这比喻太绝了" | 情绪高点 |
    | 5 | 1:18:22 | Maia | "如果重新选，我还是会这样" | 核心观点 |

    请选择 3-4 个片段，如：`1, 2, 4`

用户: 1, 2, 4

AI: 好的，提取片段 1、2、4 并拼接片头预览...

    预览已生成：podcast_preview.mp3（68秒）

    接下来添加主题曲片头片尾...

    - 片头：Sunny Side Up 前15秒（渐入2秒，渐出3秒）
    - 片尾：Sunny Side Up 15秒（渐入3秒，渐出2秒）

    正在拼接最终音频：片头 + 预览 + 正片 + 片尾...

    完成：podcast_final.mp3

    ## 时间戳章节

    00:00 片头
    00:15 精彩预览
    01:23 正式开场：我们为什么聊这个话题
    ...
    1:18:30 片尾

    ## 标题建议

    1. 工作的意义是什么？三个打工人的真实思考
    2. ...

    ## 播客简介

    【本期话题】
    ...

    所有文件已保存，可以发布了！
```

---

## 七、FFmpeg 关键经验 ⭐

### 7.1 `-ss` 对 mp3 不可靠，必须用 `atrim`

```bash
# ❌ 错误：-ss 可能 seek 到静音位置
ffmpeg -i song.mp3 -ss 20 -t 3 output.mp3  # 结果可能是 -91dB 静音

# ✅ 正确：用 atrim 滤镜精确截取
ffmpeg -i song.mp3 \
  -af "atrim=start=5:end=8,asetpts=PTS-STARTPTS" \
  output.mp3
```

### 7.2 必须检查音频音量

截取后立即检查，-91dB 基本是静音：

```bash
ffmpeg -i output.mp3 -af "volumedetect" -f null - 2>&1 | grep max_volume
# 正常音量应该在 -20dB 到 0dB 之间
```

### 7.3 音频混合（人声 + 背景音乐）

```bash
# 人声提高到 1.8 倍 + 淡淡背景音乐 5%
ffmpeg -i voice.mp3 -i bg_music.mp3 \
  -filter_complex "[0:a]volume=1.8[voice];[1:a]volume=0.05[bg];[voice][bg]amix=inputs=2:duration=first[out]" \
  -map "[out]" -c:a libmp3lame -q:a 2 output.mp3
```

### 7.4 过渡音乐（带渐入渐出）

```bash
# 4秒片段间过渡：渐入0.5s，渐出0.5s
ffmpeg -i song.mp3 \
  -af "atrim=start=5:end=9,asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=3.5:d=0.5" \
  -c:a libmp3lame -q:a 2 music_bridge_4s.mp3

# 8秒淡入正文：渐入0.5s，然后7秒渐出到静音
ffmpeg -i song.mp3 \
  -af "atrim=start=9:end=17,asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=1:d=7" \
  -c:a libmp3lame -q:a 2 music_to_main_8s.mp3
```

---

## 八、完整预览结构（推荐）

### 结构示意

```
┌──────────┬─────────────┬────────┬─────────────┬────────────┬──────────┬──────────┐
│ 片头音乐 │ 片段1+背景  │ 音乐过渡│ 片段2+背景  │ 音乐淡入   │   正文   │ 片尾音乐 │
│  (15s)   │ 人声+5%bg   │  (4s)  │ 人声+5%bg   │   (8s)     │          │  (15s)   │
└──────────┴─────────────┴────────┴─────────────┴────────────┴──────────┴──────────┘
```

### 时间戳示例

| 部分 | 时间 | 说明 |
|------|------|------|
| 片头音乐 | 00:00-00:15 | 15秒，渐入2s→渐出3s |
| 高亮片段1 | 00:15-00:25 | 人声1.8x + 5%背景音乐 |
| 音乐过渡 | 00:25-00:29 | 4秒，渐入0.5s→渐出0.5s |
| 高亮片段2 | 00:29-00:49 | 人声1.8x + 5%背景音乐 |
| 音乐淡入 | 00:49-00:57 | 8秒，渐入0.5s→渐出7s |
| 正文 | 00:57- | 主要内容 |
| 片尾音乐 | 最后15秒 | 渐入3s→渐出2s |

### 完整制作流程

```bash
WORK_DIR="/path/to/project"
THEME_SONG="/path/to/theme.mp3"
MAIN_AUDIO="/path/to/main.mp3"

# 1. 片头音乐（15秒）
ffmpeg -i "$THEME_SONG" \
  -af "atrim=start=0:end=15,asetpts=PTS-STARTPTS,afade=t=in:d=2,afade=t=out:st=12:d=3" \
  -c:a libmp3lame -q:a 2 "$WORK_DIR/intro_music.mp3"

# 2. 为每个高亮片段添加背景音乐
# 先生成对应时长的背景音乐（5%音量）
ffmpeg -i "$THEME_SONG" \
  -af "atrim=start=15:end=25,asetpts=PTS-STARTPTS,volume=0.05" \
  -c:a libmp3lame -q:a 2 "$WORK_DIR/bg_10s.mp3"

# 混合：人声(1.8x) + 背景音乐
ffmpeg -i "$WORK_DIR/clip1.mp3" -i "$WORK_DIR/bg_10s.mp3" \
  -filter_complex "[0:a]volume=1.8[voice];[voice][1:a]amix=inputs=2:duration=first[out]" \
  -map "[out]" -c:a libmp3lame -q:a 2 "$WORK_DIR/clip1_with_bg.mp3"

# 3. 片段间音乐过渡（4秒）
ffmpeg -i "$THEME_SONG" \
  -af "atrim=start=5:end=9,asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=3.5:d=0.5" \
  -c:a libmp3lame -q:a 2 "$WORK_DIR/music_bridge_4s.mp3"

# 4. 淡入正文音乐（8秒）
ffmpeg -i "$THEME_SONG" \
  -af "atrim=start=9:end=17,asetpts=PTS-STARTPTS,afade=t=in:d=0.5,afade=t=out:st=1:d=7" \
  -c:a libmp3lame -q:a 2 "$WORK_DIR/music_to_main_8s.mp3"

# 5. 片尾音乐（15秒）
ffmpeg -i "$THEME_SONG" \
  -af "atrim=start=30:end=45,asetpts=PTS-STARTPTS,afade=t=in:d=3,afade=t=out:st=13:d=2" \
  -c:a libmp3lame -q:a 2 "$WORK_DIR/outro_music.mp3"

# 6. 拼接最终版本
ffmpeg -y \
  -i "$WORK_DIR/intro_music.mp3" \
  -i "$WORK_DIR/clip1_with_bg.mp3" \
  -i "$WORK_DIR/music_bridge_4s.mp3" \
  -i "$WORK_DIR/clip2_with_bg.mp3" \
  -i "$WORK_DIR/music_to_main_8s.mp3" \
  -i "$MAIN_AUDIO" \
  -i "$WORK_DIR/outro_music.mp3" \
  -filter_complex "[0:a][1:a][2:a][3:a][4:a][5:a][6:a]concat=n=7:v=0:a=1[outa]" \
  -map "[outa]" -c:a libmp3lame -q:a 2 \
  "$WORK_DIR/podcast_final.mp3"
```

---

## 九、时间戳偏移计算

加入片头预览后，正文内容的时间戳需要加上偏移量。

### 计算方法

```
偏移量 = 片头音乐 + 片段1 + 过渡 + 片段2 + 淡入
       = 15 + 10 + 4 + 20 + 8 = 57 秒
```

### 示例

| 原时间戳 | 偏移后 |
|----------|--------|
| 00:45 正式开场 | 00:57 正式开场 (+12秒) |
| 01:30 话题一 | 01:42 话题一 |
| 10:00 话题二 | 10:12 话题二 |

**注意**：如果原时间戳基于旧版本（如 00:45 正式开场），需要计算差值（57-45=12秒），给所有时间戳加上这个差值。

---

## 十、输出文件组织

### 发布素材文件夹

```bash
mkdir -p "$WORK_DIR/发布素材"

# 复制最终文件
cp "$WORK_DIR/podcast_final.mp3" "$WORK_DIR/发布素材/播客名_最终版.mp3"
cp "$WORK_DIR/podcast_时间戳.txt" "$WORK_DIR/发布素材/"
cp "$WORK_DIR/podcast_标题建议.txt" "$WORK_DIR/发布素材/"
cp "$WORK_DIR/podcast_简介.txt" "$WORK_DIR/发布素材/"
```

### 输出结构

```
发布素材/
├── 播客名_最终版.mp3     # 最终音频
├── podcast_时间戳.txt    # 时间戳章节（已偏移）
├── podcast_标题建议.txt  # 标题选项
└── podcast_简介.txt      # 播客简介
```

---

## 反馈记录

### 2026-02-02
- **FFmpeg `-ss` 对 mp3 不可靠**
  - 问题：用 `-ss 45 -t 3` 截取音乐，结果是 -91dB 静音
  - 原因：`-ss` 对 mp3 文件 seek 不准确
  - 解决：改用 `atrim` 滤镜精确截取
  - 教训：截取后必须用 `volumedetect` 检查音量

- **完整预览结构**
  - 旧结构：片头 → 预览 → 正文 → 片尾（预览太生硬）
  - 新结构：片头 → 片段1+bg → 4s过渡 → 片段2+bg → 8s淡入 → 正文 → 片尾
  - 改进：高亮片段加淡淡背景音乐，片段间有音乐过渡

- **音频混合参数**
  - 人声：提高到 1.8 倍（原来太小）
  - 背景音乐：5% 音量（20% 太响，10% 刚好，5% 更安全）
  - 过渡音乐：正常音量，4秒，渐入渐出各0.5s
  - 淡入正文：8秒，渐入0.5s后渐出7s

- **输出组织**
  - 新增「发布素材」文件夹，集中存放最终输出
  - 时间戳文件需要更新偏移量

### 2026-01-17
- **高亮片段不要只是单句**：用户反馈高亮片段可以是几句连起来的一段话，不用只选一句
  - 已更新：推荐时考虑完整段落，包含上下文，让片段更有故事感和完整性

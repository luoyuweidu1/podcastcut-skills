---
name: podcastcut:后期
description: 播客最终润色。高亮片段预览、片头背景音乐、时间戳章节、标题建议、播客简介。触发词：最终润色、final touch、加片头、生成时间戳
---

# 播客最终润色

> 高亮片段 → 片头预览 → 主题曲片头片尾 → 时间戳章节 → 标题 + 简介

---

## ⚠️ 启动时必须询问音乐和时长

**在开始任何工作之前，必须先询问用户：**

```
在开始最终润色之前，请提供以下信息：

1. **片头音乐文件路径**（用于片头背景音乐）
   - 例如：`/path/to/intro-music.mp3`

2. **片尾音乐文件路径**（用于片尾背景音乐）
   - 如果和片头相同，可以说"同片头"
   - 如果不需要片尾音乐，请告诉我

3. **已剪辑好的播客音频路径**
   - 例如：`/path/to/podcast_v2.mp3`

4. **（可选）逐字稿或转录 JSON 路径**
   - 用于分析高亮片段和生成时间戳

```

**不要假设用户使用任何特定的音乐！** 每个播客的片头片尾风格都不同。

### 没有音乐？推荐免费音乐下载网站

如果用户还没有片头/片尾音乐，推荐以下网站寻找免费可商用的 MP3 音乐：

| 网站 | 特点 | 许可 |
|------|------|------|
| [Free Music Archive](https://freemusicarchive.org/) | 海量独立音乐，按风格/情绪筛选 | Creative Commons，注意看具体曲目许可 |
| [Pixabay Music](https://pixabay.com/music/) | 完全免费商用，无需署名 | Pixabay License，可商用 |
| [Incompetech](https://incompetech.com/music/) | Kevin MacLeod 的经典库，风格丰富 | 免费需署名，付费免署名 |
| [Unminus](https://www.unminus.com/) | 简洁无广告，试听方便 | 免费可商用 |
| [YouTube Audio Library](https://studio.youtube.com/channel/audio) | Google 出品，搜索方便 | 部分免费，部分需署名 |
| [淘声网](https://www.tosound.com/) | 中文界面，音效+音乐 | 查看具体许可 |
| [爱给网](https://www.aigei.com/music/cc/) | 中文界面，CC 协议音乐专区 | Creative Commons |

> **提示**：下载后确认文件是 MP3 格式。如果是其他格式，可用 `ffmpeg -i input.wav -c:a libmp3lame -b:a 192k output.mp3` 转换。

### ⚠️ 收到音乐后：确认时长方案

收到用户提供的音乐路径后，**展示默认方案并询问确认**：

```
收到！音乐配置如下：

| 位置 | 音乐文件 | 时长 | 渐入 | 渐出 |
|------|----------|------|------|------|
| 片头 | intro-music.mp3 | 15秒 | 2秒 | 3秒 |
| 片尾 | outro-music.mp3 | 15秒 | 5秒 | 3秒 |

是否需要调整时长？直接回复确认，或告诉我你想要的时长（如"片头20秒，片尾10秒"）。
```

### ⚠️ 跨机器兼容：音乐文件必须复制到项目目录

收到用户提供的音乐路径后，**第一件事**就是复制到项目的 `3_后期/` 目录：

```bash
# 片头音乐
cp "$USER_INTRO_MUSIC" "$WORK_DIR/theme_intro.mp3"
THEME_INTRO="$WORK_DIR/theme_intro.mp3"

# 片尾音乐（可能与片头相同）
cp "$USER_OUTRO_MUSIC" "$WORK_DIR/theme_outro.mp3"
THEME_OUTRO="$WORK_DIR/theme_outro.mp3"
```

**之后所有命令都用 `$WORK_DIR/theme_intro.mp3` 和 `$WORK_DIR/theme_outro.mp3`，禁止使用用户原始的绝对路径。**
这样项目目录是自包含的，分享给别人时音乐文件已经在里面。

---

## 片头片尾规则（通用）

| 位置 | 默认时长 | 效果 | 可配置 |
|------|----------|------|--------|
| 片头 | 15秒 | 片头音乐渐入 → 人声开始时渐出 | 时长、音乐文件 |
| 片尾 | 15秒 | 人声结束后 → 片尾音乐渐入 → 渐出结束 | 时长、音乐文件 |

**片头和片尾可以使用不同的音乐文件**，也可以使用同一首。时长可在启动时自定义。

---

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
- （可选）片头音乐文件
- （可选）片尾音乐文件（可与片头不同）

## 输出

1. **片头预览** - 3-4个高亮片段拼接到片头
2. **带背景音乐的片头** - 预览片段配上背景音乐
3. **时间戳章节** - 适合YouTube/播客平台的章节列表
4. **标题建议** - 3-5个标题选项
5. **播客简介** - 适合发布的简介文案

---

## 流程

```
0. 询问用户：片头音乐、片尾音乐、播客音频路径、逐字稿路径
    ↓
0.5 展示默认时长方案（片头15秒、片尾15秒），等待用户确认或修改
    ↓
1. 分析内容，推荐高亮片段
    ↓
【用户选择 3-4 个片段】
    ↓
2. 提取片段 + 拼接片头预览
    ↓
3. 添加片头音乐（默认15秒，渐入渐出）
    ↓
4. 添加片尾音乐（默认15秒，渐入渐出）
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

## 三、片头片尾音乐（支持不同音乐 + 自定义时长）

### 结构示意

```
┌─────────────────────────────────────────────────────────────────┐
│  片头音乐     │  高亮预览  │     正片内容     │  片尾音乐     │
│  (可配置时长) │  (30-90秒) │                  │  (可配置时长) │
│  渐入→渐出   │            │                  │  渐入→渐出   │
│ ↑片头音乐文件 │            │                  │ ↑片尾音乐文件 │
└─────────────────────────────────────────────────────────────────┘
```

**片头和片尾可以使用不同的音乐文件。** 例如片头用轻快的 jingle，片尾用抒情的结尾曲。

### 时长配置

| 位置 | 默认时长 | 可选范围 | 渐入默认 | 渐出默认 |
|------|----------|----------|----------|----------|
| 片头 | 15秒 | 5-30秒 | 2秒 | 3秒 |
| 片尾 | 15秒 | 5-30秒 | 5秒 | 3秒 |

渐入渐出会根据用户指定的时长自适应调整：
- **时长 ≤ 10秒**：渐入2秒，渐出2秒
- **时长 10-20秒**：渐入5秒，渐出3秒（默认）
- **时长 > 20秒**：渐入5秒，渐出4秒

### 片头处理

```bash
# 变量（启动时由用户确认）
THEME_INTRO="$WORK_DIR/theme_intro.mp3"
INTRO_DUR=15        # 用户可修改，默认15秒
INTRO_FADE_IN=2     # 根据时长自适应
INTRO_FADE_OUT=3    # 根据时长自适应
INTRO_FADE_OUT_ST=$((INTRO_DUR - INTRO_FADE_OUT))

# 1. 提取片头音乐
ffmpeg -i "$THEME_INTRO" \
  -af "atrim=start=0:end=$INTRO_DUR,asetpts=PTS-STARTPTS,afade=t=in:d=$INTRO_FADE_IN,afade=t=out:st=$INTRO_FADE_OUT_ST:d=$INTRO_FADE_OUT" \
  -c:a libmp3lame -b:a 128k intro_music.mp3

# 2. 拼接：片头音乐 + 预览 + 正片
ffmpeg -i intro_music.mp3 -i preview_and_main.mp3 \
  -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[outa]" \
  -map "[outa]" output_with_intro.mp3
```

### 片尾处理

```bash
# 变量（启动时由用户确认）
THEME_OUTRO="$WORK_DIR/theme_outro.mp3"
OUTRO_DUR=15        # 用户可修改，默认15秒
OUTRO_FADE_IN=5     # 根据时长自适应
OUTRO_FADE_OUT=3    # 根据时长自适应
OUTRO_FADE_OUT_ST=$((OUTRO_DUR - OUTRO_FADE_OUT))

# 1. 提取片尾音乐（注意：片尾音乐可能与片头不同）
ffmpeg -i "$THEME_OUTRO" \
  -af "atrim=start=0:end=$OUTRO_DUR,asetpts=PTS-STARTPTS,afade=t=in:d=$OUTRO_FADE_IN,afade=t=out:st=$OUTRO_FADE_OUT_ST:d=$OUTRO_FADE_OUT" \
  -c:a libmp3lame -b:a 128k outro_music.mp3

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
- [ ] 询问用户：片头音乐、片尾音乐、播客音频路径、逐字稿路径
- [ ] 展示默认时长方案（片头15秒、片尾15秒），等待用户确认或修改
- [ ] 分析内容，推荐高亮片段（5-8个）
- [ ] 等待用户选择 3-4 个片段
- [ ] 提取并拼接片头预览
- [ ] 添加片头音乐（用户确认的时长，渐入渐出）
- [ ] 添加片尾音乐（用户确认的时长，渐入渐出）
- [ ] 生成时间戳章节
- [ ] 生成标题建议
- [ ] 生成播客简介
```

---

## 输出文件

```
theme_intro.mp3               # 片头音乐（本地副本）
theme_outro.mp3               # 片尾音乐（本地副本，可能与片头不同）
podcast_preview.mp3           # 高亮片段预览
podcast_intro.mp3             # 片头音乐（已处理渐入渐出）
podcast_outro.mp3             # 片尾音乐（已处理渐入渐出）
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

AI: 好的，我来帮你做最终润色。在开始之前，请提供以下信息：

    1. **片头音乐文件路径**
       - 例如：`/path/to/intro-music.mp3`

    2. **片尾音乐文件路径**
       - 如果和片头相同，可以说"同片头"
       - 如果不需要片尾音乐，请告诉我

    3. **已剪辑好的播客音频路径**
       - 例如：`/path/to/podcast_v2.mp3`

    4. **（可选）逐字稿或转录 JSON 路径**
       - 用于分析高亮片段和生成时间戳

用户: 片头用 ~/Music/intro-jingle.mp3，片尾用 ~/Music/outro-piano.mp3，播客是 ~/podcast/episode1_v2.mp3

AI: 收到！音乐配置如下：

    | 位置 | 音乐文件 | 时长 | 渐入 | 渐出 |
    |------|----------|------|------|------|
    | 片头 | intro-jingle.mp3 | 15秒 | 2秒 | 3秒 |
    | 片尾 | outro-piano.mp3 | 15秒 | 5秒 | 3秒 |

    是否需要调整时长？直接回复确认，或告诉我你想要的时长。

用户: 片头20秒，片尾10秒

AI: 好的，已更新：片头20秒（渐入2秒，渐出3秒），片尾10秒（渐入2秒，渐出2秒）。

    正在分析内容，寻找高亮片段...

    ## 推荐高亮片段

    | # | 时间 | 说话人 | 内容 | 推荐理由 |
    |---|------|--------|------|----------|
    | 1 | 15:32 | 主播A | "..." | 金句 |
    | 2 | 32:45 | 主播B | "..." | 情感共鸣 |
    | 3 | 48:20 | 嘉宾 | "..." | 故事悬念 |
    | 4 | 1:05:30 | 主播A | "..." | 情绪高点 |
    | 5 | 1:18:22 | 主播B | "..." | 核心观点 |

    请选择 3-4 个片段，如：`1, 2, 4`

用户: 1, 2, 4

AI: 好的，提取片段 1、2、4 并拼接片头预览...

    预览已生成：podcast_preview.mp3（68秒）

    接下来添加片头片尾音乐...

    - 片头：intro-jingle.mp3 前20秒（渐入2秒，渐出3秒）
    - 片尾：outro-piano.mp3 前10秒（渐入1秒，渐出2秒）

    正在拼接最终音频：片头 + 预览 + 正片 + 片尾...

    完成：podcast_final.mp3

    ## 时间戳章节

    00:00 片头
    00:20 精彩预览
    01:28 正式开场
    ...

    ## 标题建议

    1. ...
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

### 7.3 音频混合：必须用 `amerge+pan`，禁止用 `amix`

**⚠️ 关键教训：`amix` 会对所有输入做归一化（除以输入数量），导致人声被严重衰减到听不见！**

```bash
# ❌ 错误：amix 会把人声音量除以 2，导致人声听不见
ffmpeg -i voice.mp3 -i bg_music.mp3 \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first[out]" \
  -map "[out]" output.mp3

# ✅ 正确：amerge + pan 做纯信号叠加，不衰减任何输入
ffmpeg -i voice.wav -i bg_music.wav \
  -filter_complex "[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]" \
  -map "[out]" -c:a pcm_s16le output.wav
```

叠加多个音频时，用 `amerge+pan` 逐步叠加：
```bash
# 先叠加 voice1 到 silence base
ffmpeg -i base.wav -i voice1.wav \
  -filter_complex "[1:a]volume=2.0,adelay=10000|10000,apad=whole_dur=89[v];[0:a][v]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]" \
  -map "[out]" step1.wav
# 再叠加 voice2
ffmpeg -i step1.wav -i voice2.wav \
  -filter_complex "[1:a]volume=2.0,adelay=23000|23000,apad=whole_dur=89[v];[0:a][v]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]" \
  -map "[out]" step2.wav
```

### 7.4 `-ss` 位置决定滤镜时间坐标系

**⚠️ 当 `-af` 和 `-ss` 一起使用时，`-ss` 必须放在 `-i` 之前！**

```bash
# ❌ 错误：-ss 在 -i 之后（输出选项）→ 滤镜处理整个文件时间线
# afade 在全局时间执行，到片段位置时音量已衰减为 0
ffmpeg -i source.wav -ss 10 -to 17 -af "afade=t=out:st=6.93:d=0.3" output.wav

# ✅ 正确：-ss 在 -i 之前（输入选项），用 -t 替代 -to
# 滤镜时间从 0 开始，和片段对齐
ffmpeg -ss 10 -i source.wav -t 7 -af "afade=t=out:st=6.7:d=0.3" output.wav
```

**真实案例**：`cut_audio.py` 因此 bug 导致精剪版除第一个片段外全部静音（55 分钟无声）。

### 7.5 连续背景音乐：用 volume expression 动态调音量（原 7.4）

**⚠️ 关键教训：片段间过渡不要用分开的音乐片段拼接（会跳切不连续），应该用一条连续音乐轨道 + `volume=eval=frame` 动态控制音量。**

```bash
# 创建一条连续的背景音乐轨，人声出现时自动降低音量
# volume expression 根据时间点动态调整：
#   - 片头区域（0-10s）：正常音量 1.0
#   - 人声高亮区域：降到 0.08（若有若无，不盖人声）
#   - 过渡间隙：恢复到 1.0（音乐过渡段）
#   - 进出人声区域：1.5s 平滑渐变
ffmpeg -i "$THEME_INTRO" \
  -af "atrim=start=0:end=89,asetpts=PTS-STARTPTS,\
afade=t=in:st=0:d=2,afade=t=out:st=86:d=3,\
volume=eval=frame:volume='if(lt(t,8),1.0,\
if(lt(t,10),1.0-(t-8)/2*(1.0-0.08),\
if(lt(t,17.36),0.08,\
if(lt(t,18.86),0.08+(t-17.36)/1.5*(1.0-0.08),\
if(lt(t,21.86),1.0,\
if(lt(t,23.36),1.0-(t-21.86)/1.5*(1.0-0.08),\
... ))))))'" \
  -c:a pcm_s16le music_bed.wav

# 然后用 amerge+pan 叠加人声轨道（见 7.3）
```

参数参考：
- **人声增益**：2.0x（让人声明显突出于背景音乐）
- **背景音乐（人声时）**：8%（0.08），若有若无的氛围
- **音乐过渡段**：100%（1.0）正常音量
- **渐变时长**：1.5s，音乐在人声前后平滑升降
- **过渡到正文**：9秒，渐入1.5s + 渐出2s

### 7.6 过渡到正文音乐

```bash
# 9秒过渡到正文：渐入1.5s，渐出2s
ffmpeg -i song.mp3 \
  -af "atrim=start=60:end=69,asetpts=PTS-STARTPTS,volume=0.5,afade=t=in:st=0:d=1.5,afade=t=out:st=7:d=2" \
  -c:a libmp3lame -b:a 128k music_to_content.mp3
```

---

## 八、完整预览结构（推荐）

### 核心原则

**⚠️ 整个片头区域使用一条连续的背景音乐轨道，人声叠加在上面。禁止分段拼接音乐（会跳切）。**

### 结构示意

```
┌────────────────── 连续背景音乐（一条轨道，动态调音量）──────────────────┐
│ 🔊正常    │ 🔉降低   │ 🔊正常 │ 🔉降低   │ 🔊正常 │ 🔉降低   │ 🔊渐出  │
│ 片头音乐  │ 片段1    │ 过渡   │ 片段2    │ 过渡   │ 片段3    │ →正文   │
│  (10s)    │ 人声2.0x │  (5s)  │ 人声2.0x │  (5s)  │ 人声2.0x │  (9s)   │
├───────────┼──────────┼────────┼──────────┼────────┼──────────┼─────────┤
│           │ +人声叠加 │        │ +人声叠加 │        │ +人声叠加 │         │
└───────────┴──────────┴────────┴──────────┴────────┴──────────┴─────────┘
```

### 一键生成（推荐）

用自动化脚本完成所有步骤：

```bash
# 提取好高亮片段后，一键混合背景音乐
# 注意：这里用片头音乐（theme_intro.mp3）作为高亮预览的背景音乐
python3 "$SKILL_DIR/后期/scripts/mix_highlights_with_music.py" \
  --theme "$WORK_DIR/theme_intro.mp3" \
  --clips clip1.mp3 clip2.mp3 clip3.mp3 \
  --output "$WORK_DIR/intro_complete.wav"

# 可调参数（都有合理默认值）：
#   --intro-dur 10       片头纯音乐时长
#   --gap-dur 5          片段间过渡时长
#   --outro-dur 9        尾声过渡到正文
#   --music-vol 0.08     人声时背景音量(0-1)
#   --voice-gain 2.0     人声增益倍数
#   --fade-transition 1.5 音乐升降渐变
#   --theme-start 0      主题曲截取起点

# 脚本自动：
# 1. 计算时间线（片头 → 片段 → 过渡 → 尾声）
# 2. 创建连续音乐轨（volume expression 动态调音量）
# 3. 逐步叠加人声（amerge+pan，不会衰减！）
# 4. 混合输出 + 输出时间线 JSON
```

### 音量参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 人声增益 | 2.0x | 让人声明显突出 |
| 背景音乐（人声时） | 8% (0.08) | 若有若无的氛围，不盖人声 |
| 音乐过渡段 | 100% (1.0) | 正常音量 |
| 音量渐变 | 1.5s | 音乐在人声前后平滑升降 |
| 片段间过渡 | 5s | 足够从容 |
| 过渡到正文 | 9s | 渐入1.5s + 渐出2s |

### 最终拼接

**⚠️ 正片结尾必须加渐出（3s），让正片→片尾音乐过渡自然。**

```bash
# 1. 正片加结尾渐出（最后3秒渐出）
MAIN_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MAIN_AUDIO")
FADE_START=$(echo "$MAIN_DUR - 3" | bc)
ffmpeg -y -i "$MAIN_AUDIO" \
  -af "afade=t=out:st=${FADE_START}:d=3" \
  -c:a pcm_s16le -ar 44100 -ac 2 "$WORK_DIR/main_content.wav"

# 2. 拼接：片头（已含背景音乐和人声）+ 正文（已加渐出）+ 片尾
cat > "$WORK_DIR/concat_final.txt" << EOF
file 'intro_complete.wav'
file 'main_content.wav'
file 'outro_music.wav'
EOF

ffmpeg -f concat -safe 0 -i "$WORK_DIR/concat_final.txt" \
  -c:a libmp3lame -b:a 128k "$WORK_DIR/podcast_final.mp3"
```

### 手动制作流程（了解原理用）

<details>
<summary>展开手动 ffmpeg 命令</summary>

```bash
WORK_DIR="/path/to/project"
THEME_INTRO="$WORK_DIR/theme_intro.mp3"
THEME_OUTRO="$WORK_DIR/theme_outro.mp3"
MAIN_AUDIO="/path/to/main.mp3"

# ===== Step 1: 创建连续背景音乐轨（用片头音乐）=====
# 用 volume=eval=frame 动态调整：人声出现时降到 0.08，过渡段恢复 1.0
ffmpeg -i "$THEME_INTRO" \
  -af "atrim=start=0:end=${TOTAL_INTRO_DUR},asetpts=PTS-STARTPTS,\
afade=t=in:st=0:d=2,afade=t=out:st=$((TOTAL_INTRO_DUR-3)):d=3,\
volume=eval=frame:volume='...动态表达式...'" \
  -c:a pcm_s16le -ar 44100 -ac 2 "$WORK_DIR/music_bed.wav"

# ===== Step 2: 创建人声轨（amerge+pan 逐步叠加）=====
ffmpeg -f lavfi -i "anullsrc=r=44100:cl=stereo" -t ${TOTAL_INTRO_DUR} \
  -c:a pcm_s16le "$WORK_DIR/silence_base.wav"

ffmpeg -i "$WORK_DIR/silence_base.wav" -i "$WORK_DIR/clip1.mp3" \
  -filter_complex "[1:a]volume=2.0,adelay=${CLIP1_MS}|${CLIP1_MS},apad=whole_dur=${TOTAL_INTRO_DUR}[v];\
[0:a][v]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]" \
  -map "[out]" -c:a pcm_s16le "$WORK_DIR/voice_step1.wav"

# 重复叠加 clip2, clip3...

# ===== Step 3: 混合音乐 + 人声（amerge+pan）=====
ffmpeg -i "$WORK_DIR/music_bed.wav" -i "$WORK_DIR/voice_track_final.wav" \
  -filter_complex "[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]" \
  -map "[out]" -c:a pcm_s16le "$WORK_DIR/intro_complete.wav"
```

</details>

# 片尾音乐（用片尾音乐文件，时长由用户配置）
ffmpeg -i "$THEME_OUTRO" \
  -af "atrim=start=0:end=$OUTRO_DUR,asetpts=PTS-STARTPTS,afade=t=in:d=$OUTRO_FADE_IN,afade=t=out:st=$OUTRO_FADE_OUT_ST:d=$OUTRO_FADE_OUT" \
  -c:a libmp3lame -b:a 128k "$WORK_DIR/outro_music.mp3"
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

### 2026-02-22
- **片头→正文使用 acrossfade 过渡**
  - 问题：硬拼接（concat）导致片头→正文之间有明显断裂感
  - 解决：使用 `acrossfade=d=5:c1=tri:c2=tri` 做 5 秒交叉淡入淡出
  - 教训：任何两段音频拼接都应考虑 crossfade 而非直接 concat

- **正文→片尾使用 acrossfade 过渡**
  - 问题：正文结尾留 7.8s 静音后硬接 outro 不自然
  - 解决：正文 trim 到只留 1s 结尾静音，然后 `acrossfade=d=3` 过渡到 outro

- **高亮片段需要 fade-in/fade-out 防爆破音**
  - 问题：从原音频提取 clip 时，切点波形不在零交叉点，产生 click/pop
  - 解决：每个 clip 加 `afade=t=in:d=0.03,afade=t=out:st=X:d=0.05`（30ms 渐入 + 50ms 渐出）

- **`--gap-vol` 参数：控制高亮间过渡音乐音量**
  - 问题：高亮片段间的过渡音乐太响，和人声段的低音量背景音乐形成反差
  - 解决：`mix_highlights_with_music.py` 新增 `--gap-vol` 参数（默认 1.0），可设低（如 0.3）

### 2026-02-21
- **移除降噪功能**
  - 原因：降噪应在后期之前单独处理，不应绑定在润色流程中
  - 变更：删除整个 DeepFilterNet 降噪章节、启动询问中的降噪选项、流程中的降噪步骤

- **背景音乐音量从 16% 降到 8%**
  - 问题：`music-vol=0.16` 用户反馈偏大，人声时背景音乐存在感太强
  - 解决：改为 `music-vol=0.08`，更加若有若无
  - 同步更新脚本默认值和文档中所有 0.16 引用

- **片尾渐入渐出加长**
  - 问题：渐入3s/渐出2s 音乐出现消失太突然
  - 解决：默认改为渐入5s/渐出3s

- **正片结尾必须加渐出**
  - 问题：正片突然结束→片尾音乐渐入，过渡生硬
  - 解决：正片最后3秒加 `afade=t=out` 渐出，让正片→片尾过渡自然
  - 已写入最终拼接流程

### 2026-02-18
- **跨机器兼容：主题曲路径不能是绝对路径**
  - 问题：主题曲用 `/Users/xiangli/Music/...` 绝对路径，别人机器上找不到
  - 解决：启动时立即复制主题曲到 `3_后期/theme_song.mp3`，后续全用本地副本
  - 教训：项目目录必须自包含，不依赖外部绝对路径

- **金句+背景音乐自动化脚本**
  - 问题：手动执行多步 ffmpeg 命令容易出错，不同人操作结果不一致
  - 解决：新增 `scripts/mix_highlights_with_music.py` 一键完成
  - 教训：复杂的多步 ffmpeg 流程应封装成脚本

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
  - 人声：提高到 2.0 倍（1.8 偏小）
  - 背景音乐：16%（0.16）音量（5% 太小感觉不到，15% 会盖人声）
  - 过渡音乐：正常音量，6秒，渐入渐出各1.5s
  - 淡入正文：9秒，渐入1.5s后渐出2s

- **输出组织**
  - 新增「发布素材」文件夹，集中存放最终输出
  - 时间戳文件需要更新偏移量

### 2026-02-14
- **禁止用 `amix` 混合人声和背景音乐**
  - 问题：`amix` 会对所有输入做归一化（除以输入数），人声被严重衰减到听不见
  - 解决：改用 `amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3` 做纯信号叠加
  - 教训：多次链式 `amix` 衰减更严重，每经过一次 amix 音量减半

- **片段间音乐必须连续，不能分段拼接**
  - 问题：用不同的音乐片段做片段间过渡，听起来音乐跳切不连续
  - 解决：用一条连续的主题曲轨道 + `volume=eval=frame` 动态表达式控制音量
  - 人声出现时音乐自动降到 16%，过渡间隙恢复正常，1.5s 平滑渐变

- **人声和背景音乐混合比例**
  - 15% 背景会盖过人声 → 改为 8%（volume=0.16 在 music_bed 中）
  - 人声 1.3x 不够 → 改为 2.0x
  - 最终效果：人声清晰突出，背景音乐若有若无

### 2026-01-17
- **高亮片段不要只是单句**：用户反馈高亮片段可以是几句连起来的一段话，不用只选一句
  - 已更新：推荐时考虑完整段落，包含上下文，让片段更有故事感和完整性

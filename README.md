# PodcastCut Skills

一套用于播客/视频剪辑的 Claude Code Skills。支持内容剪辑、口误识别、粗剪/精剪等完整工作流。

## 安装

### 1. 安装 Skills

将 skill 目录复制到 `~/.claude/skills/`:

```bash
git clone https://github.com/luoyuweidu1/podcastcut-skills.git
cp -r podcastcut-skills/podcastcut-* ~/.claude/skills/
```

### 2. 安装依赖

在 Claude Code 中运行：

```
/podcastcut-install
```

这会自动安装所有依赖：
- **FunASR** - 语音转录
- **ModelScope** - 模型下载
- **FFmpeg** - 音视频剪辑

首次运行会下载 FunASR 模型到 `~/.cache/modelscope/`（约 2GB）。

---

## 功能概览

| Skill | 功能 | 输入 | 输出 |
|-------|------|------|------|
| `/podcastcut-install` | 环境准备 | 无 | 依赖安装完成 |
| `/podcastcut-content` | 端到端剪辑 | 原始音频 +（可选）剪辑指令 | 统一审查稿（内容+口误标记） |
| `/podcastcut-edit-raw` | 粗剪 | 原始音频 + 审查稿（由 content 自动调用） | 音频 v2 |
| `/podcastcut-transcribe` | 口误识别 | 音频 v2（由 content 自动调用） | 统一审查稿 |
| `/podcastcut-edit-fine` | 精剪 | 音频 v2 + 统一审查稿（用户确认后） | 音频 v3 |
| `/podcastcut-final-touch` | 最终润色 | 音频 v3 + 主题曲 | 最终音频 + 时间戳 + 标题 |
| `/podcastcut-voiceclone` | 声音克隆重生成 | 原始音频 + 修正稿 | TTS 重新生成的干净音频 |

---

## 推荐工作流

```
/podcastcut-install        ← 首次使用：安装依赖、下载模型
    ↓
原始音频/视频 +（可选）剪辑指令
    ↓
/podcastcut-content        ← 方式一：传统剪辑（删除不要的）
/podcastcut-voiceclone     ← 方式二：声音克隆（TTS重新生成）

--- 方式一：传统剪辑 ---

/podcastcut-content        ← 输入：原始音频 + 剪辑指令
    ↓                         自动执行以下步骤：
    ├─ AI分析内容           →  标记内容级删除（寒暄、跑题、隐私、啰嗦）
    ├─ /podcastcut-edit-raw →  自动粗剪，输出音频 v2
    └─ /podcastcut-transcribe → 自动口误识别
    ↓                         输出：统一审查稿（内容+口误标记）
【用户在统一审查稿中确认/修改删除标记】← 唯一等待点
    ↓
/podcastcut-edit-fine      ← 输入：音频 v2 + 统一审查稿
    ↓                         输出：音频 v3（精剪后）
/podcastcut-final-touch    ← 输入：音频 v3 + 你的主题曲
    ↓                         输出：最终音频 + 时间戳 + 标题 + 简介
发布
```

---

## 审查稿删除标记方法

在审查稿中，使用 **Markdown 删除线** `~~文字~~` 标记需要删除的内容。

### 格式

```markdown
**说话人** 00:15
~~这段话需要删除~~ `[删除: 原因]` 这段话保留。
```

### 示例

```markdown
**Maia** 00:05
~~开始了吗？能听到吗？~~ `[删除: 片头寒暄]`

**响歌歌** 00:08
~~我这边OK。~~ `[删除: 片头寒暄]` Hello，大家好，欢迎来到今天的播客。

**安安** 05:32
~~我之前在Google工作的时候~~ `[删除: 隐私-公司名]` 我之前工作的时候，遇到过类似的情况。
```

### 操作步骤

1. AI 生成审查稿，自动标记建议删除的内容（用 `~~删除线~~`）
2. 用户打开审查稿文件，检查每个删除标记
3. **确认删除**：保持删除线不变
4. **取消删除**：移除 `~~` 符号
5. **新增删除**：给需要删除的文字加上 `~~删除线~~`
6. 保存后告诉 AI "按审查稿剪辑"

### 删除类型

| 类型 | 标记 | 示例 |
|------|------|------|
| 片头寒暄 | `[删除: 片头寒暄]` | "开始了吗？" "能听到吗？" |
| 录制讨论 | `[删除: 录制讨论]` | "这段要剪掉" "回头看看" |
| 隐私-公司 | `[删除: 隐私-公司名]` | "我在Google工作" |
| 隐私-人名 | `[删除: 隐私-人名]` | "我同事张三说" |
| 跑题 | `[删除: 跑题]` | 与主题无关的讨论 |
| 啰嗦 | `[删除: 啰嗦]` | 同一观点反复说 |
| 口误 | `[删除: 口误]` | 说错重说 |
| 语气词 | `[删除: 语气词]` | "嗯"、"啊"、"就是说" |

---

## 各 Skill 详细说明

### /podcastcut-install

**用途**：首次使用前的环境准备

**输入**：无

**执行**：
```
/podcastcut-install
```

**安装内容**：
- `pip install funasr modelscope`
- `brew install ffmpeg`（macOS）或 `apt install ffmpeg`（Ubuntu）
- 下载 FunASR 模型（约 2GB）

---

### /podcastcut-content

**用途**：端到端播客剪辑入口。AI分析内容 → 自动粗剪 → 自动口误识别 → 输出统一审查稿

**输入**：
- 原始音频/视频文件
- （可选）说话人名字列表
- （可选）剪辑指令，如"不删隐私"、"保留闲聊"、"严格删跑题"

**输出**：
- `podcast_transcript.json` - 句子级时间戳
- `podcast_审查稿.md` - 统一审查稿（内容级+口误级删除标记）

**示例**：
```
用户: /podcastcut-content
用户: 帮我剪掉播客里的废话，音频是 /path/to/podcast.mp3，说话人是 Maia 和响歌歌
用户: 帮我剪播客，本期不需要删除隐私信息
```

---

### /podcastcut-edit-raw

**用途**：根据审查稿执行粗剪（句子级删除）

**输入**：
- 原始音频文件
- 用户确认后的审查稿（`podcast_审查稿.md`）

**输出**：
- `podcast_v2.mp3` - 粗剪后音频

**示例**：
```
用户: /podcastcut-edit-raw
用户: 按审查稿粗剪，音频是 /path/to/podcast.mp3
```

---

### /podcastcut-transcribe

**用途**：识别口误、语气词、短语重复

**输入**：
- 粗剪后的音频（v2）
- 原审查稿（v1，用于提取未处理的半句删除）

**输出**：
- `transcript_chars.json` - 字符级时间戳
- `审查稿.md` - 统一审查稿（v2）

**示例**：
```
用户: /podcastcut-transcribe
用户: 识别口误，音频是 /path/to/podcast_v2.mp3
```

---

### /podcastcut-edit-fine

**用途**：根据审查稿执行精剪（字符级删除）

**输入**：
- 粗剪后的音频（v2）
- 用户确认后的审查稿（v2）

**输出**：
- `podcast_v3.mp3` - 精剪后音频

**示例**：
```
用户: /podcastcut-edit-fine
用户: 执行精剪
```

---

### /podcastcut-final-touch

**用途**：最终润色（片头预览、主题曲、时间戳章节）

**输入**：
- 精剪后的音频（v3）
- **你的主题曲文件**（AI 会询问路径）
- （可选）逐字稿

**输出**：
- `podcast_final.mp3` - 最终音频
- `podcast_时间戳.txt` - 章节时间戳
- `podcast_标题建议.txt` - 标题选项
- `podcast_简介.txt` - 播客简介

**示例**：
```
用户: /podcastcut-final-touch
AI: 请提供主题曲文件路径...
用户: ~/Music/my-theme.mp3
```

---

### /podcastcut-voiceclone

**用途**：声音克隆播客剪辑。用 TTS 重新生成干净音频，替代传统的删除式剪辑。

**思路**：ASR 转录 → AI 修正文字 → 提取说话人样本 → Fish Audio 声音克隆 → TTS 逐段重新生成

**输入**：
- 原始音频文件
- `podcast_transcript.json`（已有则跳过转录）
- （可选）说话人名字

**输出**：
- `podcast_voiceclone.mp3` - 重新生成的干净音频

**依赖**：
- `FISH_API_KEY` in `.env`
- `pip install requests python-dotenv`

**示例**：
```
用户: /podcastcut-voiceclone
用户: 用声音克隆重新生成这段播客
```

---

## 目录结构

```
podcastcut-skills/
├── README.md
├── podcastcut-install/
│   └── SKILL.md
├── podcastcut-content/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── transcribe.py
│   │   └── generate_transcript.py
│   └── tips/
├── podcastcut-edit-raw/
│   ├── SKILL.md
│   └── scripts/
│       └── rough_cut.py
├── podcastcut-transcribe/
│   ├── SKILL.md
│   ├── scripts/
│   │   ├── transcribe_chars.py
│   │   ├── detect_phrase_repeats.py
│   │   └── extract_original_deletions.py
│   └── tips/
├── podcastcut-edit-fine/
│   ├── SKILL.md
│   └── scripts/
│       └── merge_deletions_fast.py
├── podcastcut-final-touch/
│   └── SKILL.md
└── podcastcut-voiceclone/
    ├── SKILL.md
    └── scripts/
        ├── extract_speaker_samples.py
        ├── create_voice_model.py
        ├── tts_generate.py
        └── merge_segments.py
```

---

## 技术栈

- **转录**: [FunASR](https://github.com/modelscope/FunASR) (阿里开源，中文识别最优)
- **剪辑**: FFmpeg (filter_complex)
- **AI分析**: Claude (语义分析、内容审核)

---

## 性能参考

| 音频时长 | 转录时间 | 句子数 |
|----------|----------|--------|
| 30 分钟 | ~4 分钟 | ~400 句 |
| 1 小时 | ~8 分钟 | ~850 句 |
| 2 小时 | ~16 分钟 | ~1700 句 |

*测试环境：M1 Mac，CPU 推理*

---

## License

MIT

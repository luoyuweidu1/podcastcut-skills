# PodcastCut Skills

一套用于播客/视频剪辑的 Claude Code Skills。支持内容剪辑、口误识别、粗剪/精剪等完整工作流。

## 功能概览

| Skill | 功能 | 触发词 |
|-------|------|--------|
| `podcastcut-install` | 环境准备：安装依赖、下载模型 | 安装、初始化 |
| `podcastcut-content` | 内容剪辑：识别寒暄、跑题、隐私等需要删除的内容 | 内容剪辑、剪内容 |
| `podcastcut-edit-raw` | 粗剪：句子级 FFmpeg 剪辑 | 粗剪、rough cut |
| `podcastcut-transcribe` | 口误识别：语气词、叠词、短语重复检测 | 识别口误、transcribe |
| `podcastcut-edit-fine` | 精剪：字符级 FFmpeg 剪辑 | 精剪、fine cut |
| `podcastcut-final-touch` | 最终润色：片头预览、主题曲、时间戳章节 | final touch、加片头 |

## 推荐工作流

```
/podcastcut-install     ← 首次使用：安装依赖、下载模型
    ↓
原始音频/视频
    ↓
/podcastcut-content     ← 标记大段内容（寒暄、跑题、啰嗦、隐私）
    ↓
/podcastcut-edit-raw    ← 粗剪，输出 v2
    ↓
【可选】还需要处理口误？
    ↓ 是
/podcastcut-transcribe  ← 识别口误、语气词、静音
    ↓
/podcastcut-edit-fine   ← 精剪，输出 v3
    ↓
/podcastcut-final-touch ← 片头预览 + 主题曲 + 时间戳 + 标题
    ↓
发布
```

## 技术栈

- **转录**: [FunASR](https://github.com/modelscope/FunASR) (阿里开源，中文识别最优)
- **剪辑**: FFmpeg (filter_complex)
- **AI分析**: Claude (语义分析、内容审核)

## 安装

### 1. 安装 FunASR

```bash
pip install funasr modelscope
```

首次运行会自动下载模型到 `~/.cache/modelscope/`（约 2GB）。

### 2. 安装 FFmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt install ffmpeg
```

### 3. 安装 Skills

将 skill 目录复制到 `~/.claude/skills/`:

```bash
cp -r podcastcut-* ~/.claude/skills/
```

## 目录结构

```
podcastcut-skills/
├── README.md
├── podcastcut-install/
│   └── SKILL.md                    # 环境准备方法论
├── podcastcut-content/
│   ├── SKILL.md                    # 内容剪辑方法论
│   ├── scripts/
│   │   ├── transcribe.py           # FunASR 转录（句子级）
│   │   └── generate_transcript.py  # 生成逐字稿
│   └── tips/
│       └── 转录最佳实践.md
├── podcastcut-edit-raw/
│   ├── SKILL.md                    # 粗剪方法论
│   └── scripts/
│       └── rough_cut.py            # 粗剪脚本
├── podcastcut-transcribe/
│   ├── SKILL.md                    # 口误识别方法论
│   ├── scripts/
│   │   ├── transcribe_chars.py     # FunASR 转录（字符级）
│   │   ├── detect_phrase_repeats.py # 短语重复检测
│   │   └── extract_original_deletions.py # 提取审查稿删除标记
│   └── tips/
│       ├── 转录最佳实践.md
│       └── 口误识别方法论.md
├── podcastcut-edit-fine/
│   ├── SKILL.md                    # 精剪方法论
│   └── scripts/
│       └── merge_deletions_fast.py # 快速模式合并
└── podcastcut-final-touch/
    └── SKILL.md                    # 最终润色方法论
```

## 核心脚本

### 转录

```bash
# 句子级转录（内容剪辑用）
python podcastcut-content/scripts/transcribe.py <音频> <输出目录>

# 字符级转录（口误识别用）
python podcastcut-transcribe/scripts/transcribe_chars.py <音频> <输出目录>
```

### 剪辑

```bash
# 粗剪（句子级）
python podcastcut-edit-raw/scripts/rough_cut.py <工作目录> <输入音频>

# 精剪（字符级，快速模式）
python podcastcut-edit-fine/scripts/merge_deletions_fast.py <工作目录> <输入> <输出>
```

## 输出文件

### 粗剪后

```
工作目录/
├── podcast_transcript.json   # 句子级时间戳
├── podcast_审查稿.md         # 带删除标记的审查稿
├── podcast_删除清单.json     # 删除时间段
├── keep_segments.json        # 保留片段
├── filter.txt                # FFmpeg filter
└── podcast_v2.mp3            # 粗剪后音频
```

### 精剪后

```
工作目录/
├── transcript_chars.json     # 字符级时间戳
├── 审查稿.md                 # 统一审查稿
├── deletions_fast.json       # 合并后删除清单
├── keep_segments_fast.json   # 保留片段
├── filter_fast.txt           # FFmpeg filter
└── podcast_v3.mp3            # 精剪后音频
```

## 性能参考

| 音频时长 | 转录时间 | 句子数 |
|----------|----------|--------|
| 30 分钟 | ~4 分钟 | ~400 句 |
| 1 小时 | ~8 分钟 | ~850 句 |
| 2 小时 | ~16 分钟 | ~1700 句 |

*测试环境：M1 Mac，CPU 推理*

### FFmpeg 剪辑性能

| 模式 | 分段数 | 处理时间 |
|------|--------|----------|
| 原版 | 570 | 38 分钟 |
| 快速模式 | 154 | 3.5 分钟 |

快速模式通过合并微小删除，加速约 11 倍。

## License

MIT

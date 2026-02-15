# Podcastcut

> 用 Claude Code Skills 构建的播客剪辑 Agent，从原始录音到发布级成品

## 为什么做这个？

传统播客编辑工具的痛点：
1. **无法理解语义**：录前准备、跑题闲聊、重复内容，工具识别不出来
2. **手动编辑耗时**：2 小时播客需要反复听找问题点
3. **口癖处理粗糙**：卡顿词、重说纠正、连续填充词，需要逐个手动处理

这个 Agent 用 Claude 的语义理解做内容分析，用阿里云 FunASR 做语音转录，用交互式审查页面做人工确认，全流程 AI 辅助。

## 效果

- 2.5 小时播客 → 3 分钟转录 + AI 分析 + 交互审查 → 精剪版 MP3
- 说话人识别 98.8% 准确度（阿里云 FunASR）
- 段落级内容删减 + 词级精剪（卡顿、重说、填充词）
- 浏览器内实时试听，所有编辑即时生效

## 安装

### 1. 注册 Skills

```bash
# Clone 项目
git clone <repo-url> /path/to/podcastcut

# 在 Claude Code 中注册（创建 symlinks）
PODCASTCUT_DIR="/path/to/podcastcut"  # 替换为你的路径
mkdir -p ~/.claude/skills
ln -s "$PODCASTCUT_DIR/安装"    ~/.claude/skills/podcastcut-安装
ln -s "$PODCASTCUT_DIR/剪播客"  ~/.claude/skills/podcastcut-剪播客
ln -s "$PODCASTCUT_DIR/后期"    ~/.claude/skills/podcastcut-后期
ln -s "$PODCASTCUT_DIR/自进化"  ~/.claude/skills/podcastcut-自进化
```

验证：重启 Claude Code，按 `/` 应该能看到 `podcastcut-安装`、`podcastcut-剪播客` 等。

### 2. 安装依赖

```bash
brew install node ffmpeg
```

### 3. 配置阿里云 API Key

```bash
cd /path/to/podcastcut
cp .env.example .env
# 编辑 .env，填入阿里云 DashScope API Key
# 获取地址：https://dashscope.console.aliyun.com/
```

### 4. 开始使用

在 Claude Code 中：

```
/podcastcut-剪播客 你的音频文件.mp3
```

详细安装说明见 `/podcastcut-安装`。

## 使用流程

```
/podcastcut-剪播客
    │
    ├─ 转录（阿里云 FunASR，~3 分钟）
    ├─ 说话人识别 + 映射
    ├─ 句子分割
    ├─ AI 内容分析（段落级删减）
    ├─ AI 精剪分析（词级：卡顿、重说、填充词）
    ├─ 生成审查页面 → 浏览器打开
    │
    │   ┌──────────────────────────────────────┐
    │   │  审查页面（review_enhanced.html）     │
    │   │                                      │
    │   │  - 内容删减概览（可折叠表格）        │
    │   │  - 精剪播放器（实时跳过删除段）      │
    │   │  - 整句删除/恢复、精剪切换           │
    │   │  - 手动选中删除、撤销                │
    │   │  - 导出剪辑文件                      │
    │   └──────────────────────────────────────┘
    │
    ├─ 用户审查 + 导出 delete_segments_edited.json
    └─ 一键剪辑 → 精剪版 MP3

/podcastcut-后期（可选）
    │
    ├─ 推荐高亮片段 → 片头预览
    ├─ 添加主题曲片头片尾
    ├─ 生成时间戳章节
    ├─ 标题建议 + 播客简介
    └─ 输出发布级成品
```

## Skill 清单

| Skill | slash 命令 | 功能 |
|-------|-----------|------|
| 安装 | `/podcastcut-安装` | 注册 skills、安装依赖、配置 API Key |
| 剪播客 | `/podcastcut-剪播客` | 转录 + AI 分析 + 审查页面 + 剪辑（核心） |
| 后期 | `/podcastcut-后期` | 片头预览、主题曲、时间戳、标题、简介 |
| 自进化 | `/podcastcut-自进化` | 记录反馈，更新方法论和规则 |

## 目录结构

```
podcastcut/
├── README.md
├── .env.example
├── 安装/                  # 环境安装 skill
│   └── SKILL.md
├── 剪播客/                # 核心 skill
│   ├── SKILL.md           # 完整流程文档（9 个步骤）
│   ├── scripts/           # 脚本
│   │   ├── aliyun_funasr_transcribe.sh   # 阿里云转录
│   │   ├── identify_speakers.js          # 说话人识别
│   │   ├── generate_subtitles_from_aliyun.js  # 字级别转录
│   │   ├── generate_sentences.js         # 句子分割
│   │   ├── generate_review_enhanced.js   # 生成审查页面
│   │   ├── cut_audio.py                  # WAV 采样级精确剪辑
│   │   └── merge_fine_edits.js           # 合并精剪编辑
│   ├── templates/
│   │   └── review_enhanced.html          # 审查页面模板
│   └── 用户习惯/          # 精剪规则（可自定义）
│       ├── README.md              # 规则索引
│       ├── 1-核心原则.md
│       ├── 2-填充词检测.md
│       ├── 3-静音段处理.md
│       ├── 4-重复句检测.md
│       ├── 5-卡顿词.md
│       ├── 6-句内重复检测.md
│       ├── 7-连续填充词.md
│       ├── 8-重说纠正.md
│       ├── 9-残句检测.md
│       └── 10-内容分析方法论.md   # 步骤5a的分析方法论
├── 后期/                  # 最终润色 skill
│   └── SKILL.md
├── 自进化/                # 自更新 skill
│   └── SKILL.md
└── output/                # 输出目录（自动创建）
    └── YYYY-MM-DD_音频名/
        └── 剪播客/
            ├── 1_转录/
            ├── 2_分析/
            ├── 3_成品/
            └── review_enhanced.html
```

## 依赖

| 依赖 | 用途 | 安装方式 |
|------|------|----------|
| Node.js | 运行脚本 | `brew install node` |
| FFmpeg | 音频处理 | `brew install ffmpeg` |
| Python 3 | 音频剪辑 | macOS 自带 |
| 阿里云 DashScope API | 语音转录 + 说话人分离 | [申请 Key](https://dashscope.console.aliyun.com/) |

## License

MIT

---
name: podcastcut:安装
description: 环境准备。注册 Skills、安装依赖、配置 API Key、验证环境。触发词：安装、环境准备、初始化
---

<!--
input: 无
output: 环境就绪
pos: 前置 skill，首次使用前运行

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. /CLAUDE.md 路由表
-->

# 安装

> 首次使用前的环境准备

## 快速使用

```
用户: 安装环境
用户: 初始化
用户: 准备播客剪辑环境
```

## 步骤 0: 注册 Skills

Claude Code 从 `~/.claude/skills/` 目录发现 skills。需要创建 symlink 指向本项目的 skill 目录。

```bash
# 设置项目路径（根据你 clone 的位置修改）
PODCASTCUT_DIR="/path/to/podcastcut"

# 创建 symlinks
ln -s "$PODCASTCUT_DIR/安装"    ~/.claude/skills/podcastcut-安装
ln -s "$PODCASTCUT_DIR/剪播客"  ~/.claude/skills/podcastcut-剪播客
ln -s "$PODCASTCUT_DIR/后期"    ~/.claude/skills/podcastcut-后期
ln -s "$PODCASTCUT_DIR/质检"    ~/.claude/skills/podcastcut-质检
ln -s "$PODCASTCUT_DIR/自进化"  ~/.claude/skills/podcastcut-自进化
```

验证：在 Claude Code 中按 `/`，应该能看到 `podcastcut-安装`、`podcastcut-剪播客` 等。

> **注意**：如果 `~/.claude/skills/` 目录不存在，先 `mkdir -p ~/.claude/skills/`。

## 步骤 1: 安装依赖

| 依赖 | 用途 | 安装命令 |
|------|------|----------|
| Node.js | 运行脚本 | `brew install node` |
| FFmpeg | 音频处理、CBR 重编码 | `brew install ffmpeg` |
| Python 3 | 音频剪辑 (`cut_audio.py`) | macOS 自带，或 `brew install python3` |
| DeepFilterNet | 音频降噪（后期可选） | `pip install deepfilternet` |
| librosa | 音频信号分析（质检） | `pip install librosa soundfile` |
| curl | API 调用 | 系统自带 |

```bash
# macOS
brew install node ffmpeg

# Python 依赖
pip install deepfilternet    # 音频降噪（可选，后期 skill 使用）
pip install librosa soundfile  # 音频信号分析（质检 skill 使用）

# 验证
node -v
ffmpeg -version
python3 --version
deepFilter --version
```

## 步骤 2: 配置 API Key

### 阿里云 DashScope（语音识别）

控制台：https://dashscope.console.aliyun.com/

1. 注册阿里云账号
2. 开通"模型服务灵积"
3. 创建 API Key

```bash
cd "$PODCASTCUT_DIR"
cp .env.example .env
# 编辑 .env，填入 API Key
```

`.env` 文件内容：

```
DASHSCOPE_API_KEY=sk-your-api-key-here
```

## 步骤 3: 验证

```bash
node -v                              # Node.js
ffmpeg -version                      # FFmpeg
python3 --version                    # Python 3
deepFilter --version                 # DeepFilterNet（可选）
cat "$PODCASTCUT_DIR/.env" | grep DASHSCOPE  # API Key
ls -la ~/.claude/skills/ | grep podcastcut   # Skills 注册
```

全部通过后即可使用：

```
/podcastcut-剪播客 你的音频文件.mp3
```

## 常见问题

### Q1: API Key 在哪获取？

阿里云控制台 → https://dashscope.console.aliyun.com/ → 创建 API Key

### Q2: ffmpeg 命令找不到

```bash
which ffmpeg  # 应该输出路径
# 如果没有：brew install ffmpeg
```

### Q3: 支持多长的播客？

- 已验证：2.5 小时（147 分钟）正常处理
- 阿里云 FunASR API 转录约 3 分钟完成（与音频时长无关）
- 无硬性上限，超长播客无需分段

### Q4: 多人对话能识别说话人吗？

支持。阿里云 FunASR API 提供说话人分离功能，实测 98.8% 准确度。需要在转录时指定正确的说话人数量。

### Q5: Skills 注册后看不到？

1. 确认 symlink 有效：`ls -la ~/.claude/skills/ | grep podcastcut`
2. 确认目标存在：`ls "$PODCASTCUT_DIR/安装/SKILL.md"`
3. 重启 Claude Code 会话（新会话会重新扫描 skills 目录）

### Q6: 如何处理音乐和音效？

使用后期 skill（`/podcastcut-后期`）：片头预览、主题曲片头片尾、时间戳章节、标题建议、播客简介。

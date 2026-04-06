# Podcastcut

录完一期两小时的播客，光是听一遍找出要删的部分就要大半天。这个工具帮你跳过这一步：丢进原始录音，AI 自动标记录前闲聊、设备调试、跑题段落、口误卡顿，你只需要在浏览器里审一遍，确认哪些删哪些留，导出，完事。

本项目 fork 自 [@luoyuweidu1](https://github.com/luoyuweidu1) 的 [podcastcut-skills](https://github.com/luoyuweidu1/podcastcut-skills)，在她的核心架构上做了一轮迭代。

---

## AI 粗剪 + 人工审查

![审查页面截图](docs/review-ui.png)

AI 完成粗剪后，你会在浏览器里看到这个审查页面。左侧是时长对比、删减摘要、说话人分布和章节导航；右侧是完整逐字稿，AI 标记删除的段落会变灰划线。点击任意句子自动播放，勾选即可删除或恢复，所有编辑自动保存。

---

## 在原版基础上的改动

实际用原版剪了几期之后，针对踩过的坑做了一轮优化：

- **音质保护** — 审查音频从 64kbps 提到 192kbps，全流程禁止压缩原始音质
- **流程精简** — 8 阶段合并为 5 步，边界更清晰
- **音质处理子技能** — 可以只对特定说话人降噪去回声，自动跳过音乐段（踩过 DeepFilterNet 把片头曲吃掉的坑）
- **审查页面重设计** — 侧边栏+逐字稿双栏布局，编辑式排版，字体放大，视觉降噪
- **去硬编码路径** — 换台电脑也能直接跑

---

## 5 步流水线

```
阶段 1  转录 + AI 分析（全自动）
        阿里云 FunASR 转录 → 说话人识别 → 粗剪分析 → 精剪分析 → AI 自审查

阶段 2  人工审核
        浏览器打开审查页面 → 审阅逐字稿 → 删除/恢复段落 → 导出

阶段 3  剪辑执行 + 质检
        采样级精确剪辑（≥192kbps）→ 静音裁剪 → 可选质检

阶段 4  音质处理（新增）
        按说话人降噪/去回声 → 音乐段保护 → 响度标准化（-16 LUFS）

阶段 5  后期
        高光片段提取 → 片头片尾音乐 → 时间戳章节 → 标题/简介
```

## 安装

```bash
# 1. Clone
git clone https://github.com/chenyusi/podcastcut-skills.git
cd podcastcut-skills

# 2. 注册 Claude Code Skills
PODCASTCUT_DIR="$(pwd)"
mkdir -p ~/.claude/skills
ln -s "$PODCASTCUT_DIR/安装"      ~/.claude/skills/podcastcut-安装
ln -s "$PODCASTCUT_DIR/剪播客"    ~/.claude/skills/podcastcut-剪播客
ln -s "$PODCASTCUT_DIR/后期"      ~/.claude/skills/podcastcut-后期
ln -s "$PODCASTCUT_DIR/质检"      ~/.claude/skills/podcastcut-质检
ln -s "$PODCASTCUT_DIR/音质处理"  ~/.claude/skills/podcastcut-音质处理

# 3. 安装依赖
brew install node ffmpeg

# 4. 配置阿里云 API Key
cp .env.example .env
# 编辑 .env，填入 DashScope API Key
# 获取地址：https://dashscope.console.aliyun.com/
```

然后在 Claude Code 里输入：

```
/podcastcut-剪播客 你的音频文件.mp3
```

详细安装说明见 `/podcastcut-安装`。

## Skill 清单

| Skill | 命令 | 做什么 |
|-------|------|--------|
| 安装 | `/podcastcut-安装` | 环境准备、依赖检查 |
| 剪播客 | `/podcastcut-剪播客` | 主流程：转录→分析→审查→剪辑 |
| 质检 | `/podcastcut-质检` | 数据层+信号层+语义层质检 |
| 音质处理 | `/podcastcut-音质处理` | 按说话人降噪、响度标准化 |
| 后期 | `/podcastcut-后期` | 片头片尾、高光、时间戳 |

## 依赖

| 依赖 | 用途 |
|------|------|
| Node.js | 运行脚本 |
| FFmpeg | 音频处理 |
| Python 3 | 音频剪辑 |
| 阿里云 DashScope API | 语音转录 |

音质处理子技能额外需要：`pip install deepfilternet pyloudnorm librosa soundfile`

## 致谢

感谢 [@luoyuweidu1](https://github.com/luoyuweidu1) 创建了 podcastcut-skills。核心架构——阿里云 FunASR 转录、规则+LLM 混合精剪、交互式审查页面、三阶段质检——都是她的工作。本项目在此基础上做了工作流优化、UI 重设计和功能扩展。

## License

MIT

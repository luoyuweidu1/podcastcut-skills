# Podcastcut

> 用 Claude Code Skills 构建的播客剪辑 Agent，从原始录音到发布级成品

## 为什么做这个？

传统播客编辑工具的痛点：
1. **无法理解语义**：录前准备、跑题闲聊、重复内容，工具识别不出来
2. **手动编辑耗时**：2 小时播客需要反复听找问题点
3. **口癖处理粗糙**：卡顿词、重说纠正、连续填充词，需要逐个手动处理

这个 Agent 用 Claude 的语义理解做内容分析，用阿里云 FunASR 做语音转录，用交互式审查页面做人工确认，全流程 AI 辅助。

## 效果

- 2~3小时播客 → 3 分钟转录 + AI 分析 + 交互审查 → 精剪版 MP3
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
ln -s "$PODCASTCUT_DIR/质检"    ~/.claude/skills/podcastcut-质检
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

## 8 阶段流水线

```
/podcastcut-剪播客
    │
    │  阶段 1: 用户启动
    │  ├─ 新用户：样本学习 / 结构化提问
    │  └─ 老用户：一句话确认偏好
    │
    │  阶段 2: 剪辑分析
    │  ├─ 转录（阿里云 FunASR，~3 分钟）
    │  ├─ 说话人识别 + 句子分割
    │  ├─ AI 粗剪分析（段落级删减）
    │  └─ AI 精剪分析（词级：卡顿、重说、填充词）
    │
    │  阶段 3: AI 自审查
    │  └─ 审查 Agent 检查一致性、误判、安全词
    │
    │  阶段 4: 用户审核稿
    │  ├─ 生成审查页面 → 浏览器打开
    │  │   ┌──────────────────────────────────────┐
    │  │   │  审查页面（review_enhanced.html）     │
    │  │   │  - 精剪播放器（实时跳过删除段）      │
    │  │   │  - 整句删除/恢复、精剪切换           │
    │  │   │  - 手动选中删除 + AI 反馈导出        │
    │  │   └──────────────────────────────────────┘
    │  ├─ 用户审查 + 导出 delete_segments_edited.json
    │  └─ 反馈学习 → 更新用户偏好/剪辑规则
    │
    │  阶段 5: 剪辑执行
    │  ├─ cut_audio.py（WAV 采样级精确剪辑）
    │  └─ trim_silences.py（成品静音裁剪）
    │
/podcastcut-质检
    │  阶段 6: AI 质检
    │  ├─ Phase A: 数据层（删除段正确性）
    │  ├─ Phase B: 信号层（能量/频谱/静音分析）
    │  └─ Phase C: 语义层（重转录 LCS 对齐，可选）
    │
/podcastcut-后期
    │  阶段 7: 后期处理
    │  ├─ 高亮片段 → 片头预览
    │  ├─ 主题曲片头片尾
    │  └─ 时间戳章节 + 标题 + 简介
    │
    │  阶段 8: 用户终审
    │  ├─ 终审页面（review_final.html）
    │  │   质检问题列表 + 可点击时间戳 + 确认/标记
    │  └─ 反馈学习 → 更新剪辑规则/用户偏好
```

## Skill 清单

| Skill | slash 命令 | 功能 |
|-------|-----------|------|
| 安装 | `/podcastcut-安装` | 注册 skills、安装依赖、配置 API Key |
| 剪播客 | `/podcastcut-剪播客` | 8 阶段编排器：转录 + 分析 + 审查 + 剪辑 + 终审 |
| 质检 | `/podcastcut-质检` | 三阶段质检：数据层 + 信号层 + 语义层 |
| 后期 | `/podcastcut-后期` | 片头预览、主题曲、时间戳、标题、简介 |

## 目录结构

```
podcastcut/
├── README.md
├── .env.example
├── 安装/                  # 环境安装 skill
│   └── SKILL.md
├── 剪播客/                # 核心 skill（阶段 1-5, 8）
│   ├── SKILL.md           # 完整流程文档（8 阶段）
│   ├── scripts/
│   │   ├── aliyun_funasr_transcribe.sh   # 阿里云转录
│   │   ├── identify_speakers.js          # 说话人识别
│   │   ├── generate_subtitles_from_aliyun.js  # 字级别转录
│   │   ├── generate_sentences.js         # 句子分割
│   │   ├── generate_review_enhanced.js   # 生成审查页面（阶段 4）
│   │   ├── generate_review_final.js      # 生成终审页面（阶段 8）
│   │   ├── capture_final_feedback.js     # 终审反馈捕获
│   │   ├── cut_audio.py                  # WAV 采样级精确剪辑
│   │   ├── trim_silences.py              # 成品静音裁剪
│   │   ├── merge_llm_fine.js             # 合并精剪编辑
│   │   └── user_manager.js              # 用户偏好管理
│   ├── templates/
│   │   └── review_enhanced.html          # 审查页面模板
│   ├── 基础剪辑规则/       # 共享规则（所有用户通用）
│   │   ├── 1-核心原则.md
│   │   ├── 2-语气词检测.md
│   │   ├── ...
│   │   └── 10-内容分析方法论.md
│   └── 用户偏好/           # 个人偏好（per-user）
│       ├── default/
│       └── <userId>/
├── 后期/                  # 最终润色 skill（阶段 7）
│   ├── SKILL.md
│   └── scripts/
│       └── mix_highlights_with_music.py
├── 质检/                  # 质检 skill（阶段 6）
│   ├── SKILL.md
│   └── scripts/
│       ├── signal_analysis.py     # 信号层分析
│       ├── semantic_review.js     # 语义层分析
│       ├── audit_cut.js           # 数据层审计
│       └── report_generator.py    # 综合报告
└── output/                # 输出目录（自动创建）
    └── YYYY-MM-DD_音频名/
        └── 剪播客/
            ├── 1_转录/
            ├── 2_分析/
            ├── 3_成品/
            ├── review_enhanced.html
            └── review_final.html
```

## 两层学习架构

| 层 | 目录 | 内容 | 触发 |
|---|---|---|---|
| 基础剪辑规则 | `剪播客/基础剪辑规则/` | 检测算法、通用阈值、方法论 | 质检发现的算法缺陷 |
| 用户偏好 | `剪播客/用户偏好/<userId>/` | 激进度、特定词保留/删除 | 用户审核反馈 |

反馈在阶段 4（用户审核）、阶段 6（AI 质检）、阶段 8（用户终审）三个点捕获，持久化到 skill 文档中，确保跨机器、跨账号可用。

## 依赖

| 依赖 | 用途 | 安装方式 |
|------|------|----------|
| Node.js | 运行脚本 | `brew install node` |
| FFmpeg | 音频处理 | `brew install ffmpeg` |
| Python 3 | 音频剪辑 | macOS 自带 |
| 阿里云 DashScope API | 语音转录 + 说话人分离 | [申请 Key](https://dashscope.console.aliyun.com/) |

## License

MIT

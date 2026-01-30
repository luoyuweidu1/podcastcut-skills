---
name: videocut:剪口播
description: 口播视频转录和口误识别。生成审查稿和删除任务清单。触发词：剪口播、处理视频、识别口误
---

<!--
input: 视频文件 (*.mp4)
output: subtitles_words.json、auto_selected.json、review.html
pos: 转录+识别，到用户网页审核为止

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. /CLAUDE.md 路由表
-->

# 剪口播 v2

> 火山引擎转录 + AI 口误识别 + 网页审核

## 快速使用

```
用户: 帮我剪这个口播视频
用户: 处理一下这个视频
```

## 输出目录结构

```
output/
└── YYYY-MM-DD_视频名/     # 日期+视频名
    ├── 剪口播/            # 本 skill 输出
    │   ├── audio.mp3
    │   ├── volcengine_result.json
    │   ├── subtitles_words.json
    │   ├── auto_selected.json
    │   └── review.html
    └── 字幕/              # 字幕 skill 输出
        └── ...
```

**规则**：已有文件夹则复用，否则新建。

## 流程

```
0. 创建输出目录
    ↓
1. 提取音频 (ffmpeg)
    ↓
2. 上传获取公网 URL (uguu.se)
    ↓
3. 火山引擎 API 转录
    ↓
4. 生成字级别字幕 (subtitles_words.json)
    ↓
5. AI 分析口误/静音，生成预选列表 (auto_selected.json)
    ↓
6. 生成审核网页 (review.html)
    ↓
7. 启动审核服务器，用户网页确认
    ↓
【等待用户确认】→ 网页点击「执行剪辑」或手动 /剪辑
```

## 执行步骤

### 步骤 0: 创建输出目录

```bash
# 变量设置（根据实际视频调整）
VIDEO_PATH="/path/to/视频.mp4"
VIDEO_NAME=$(basename "$VIDEO_PATH" .mp4)
DATE=$(date +%Y-%m-%d)
OUTPUT_DIR="output/${DATE}_${VIDEO_NAME}/剪口播"

# 创建目录（已存在则跳过）
mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"
```

### 步骤 1-3: 转录

```bash
# 1. 提取音频（文件名有冒号需加 file: 前缀）
ffmpeg -i "file:$VIDEO_PATH" -vn -acodec libmp3lame -y audio.mp3

# 2. 上传获取公网 URL
curl -s -F "files[]=@audio.mp3" https://uguu.se/upload
# 返回: {"success":true,"files":[{"url":"https://h.uguu.se/xxx.mp3"}]}

# 3. 调用火山引擎 API
SKILL_DIR="/Users/chengfeng/Desktop/AIos/剪辑Agent/.claude/skills/剪口播"
"$SKILL_DIR/scripts/volcengine_transcribe.sh" "https://h.uguu.se/xxx.mp3"
# 输出: volcengine_result.json
```

### 步骤 4: 生成字幕

```bash
node "$SKILL_DIR/scripts/generate_subtitles.js" volcengine_result.json
# 输出: subtitles_words.json
```

### 步骤 5: AI 分析口误（手动，禁止脚本）

#### 5.1 生成易读格式

```bash
node -e "
const data = require('./subtitles_words.json');
let output = [];
data.forEach((w, i) => {
  if (w.isGap) {
    const dur = (w.end - w.start).toFixed(2);
    if (dur >= 0.5) output.push(i + '|[静' + dur + 's]|' + w.start.toFixed(2) + '-' + w.end.toFixed(2));
  } else {
    output.push(i + '|' + w.text + '|' + w.start.toFixed(2) + '-' + w.end.toFixed(2));
  }
});
require('fs').writeFileSync('readable.txt', output.join('\n'));
"
```

#### 5.2 读取用户习惯

先读 `用户习惯/` 目录下所有规则文件。

#### 5.3 分段读取分析

每次读取 300 行，逐段分析：

```
Read readable.txt offset=0 limit=300
Read readable.txt offset=300 limit=300
...
```

#### 5.4 边分析边记录

创建 `口误分析.md` 记录删除清单：

```markdown
| idx范围 | 时间 | 类型 | 内容 | 处理 |
|---------|------|------|------|------|
| 0 | 0.00-1.44 | 静音1.44s | 开头静音 | 删 |
| 64-74 | 15.80-17.66 | 重复句 | "这是我剪出来的一个案例" | 删 |
```

#### 5.5 检测规则（按优先级）

1. **静音 ≥1s** → 按1秒格子拆分输出
2. **重复句** → 相邻句子开头≥5字相同，删短的
3. **句内重复** → A+中间+A 模式，删前面
4. **卡顿词** → 那个那个、就是就是，删前面
5. **重说纠正** → 部分重复/否定纠正，删前面
6. **语气词** → 标记但不自动删，留给用户

#### 5.6 生成预选索引

分析完成后，汇总所有要删除的 idx 到 `auto_selected.json`

### 步骤 6-7: 审核

```bash
# 6. 生成审核网页
node "$SKILL_DIR/scripts/generate_review.js" subtitles_words.json auto_selected.json audio.mp3

# 7. 启动审核服务器
node "$SKILL_DIR/scripts/review_server.js" 8899 "$VIDEO_PATH"
# 打开 http://localhost:8899
```

用户在网页中：
- 播放视频片段确认
- 勾选/取消删除项
- 点击「执行剪辑」

---

## 数据格式

### subtitles_words.json

```json
[
  {"text": "大", "start": 0.12, "end": 0.2, "isGap": false},
  {"text": "", "start": 6.78, "end": 7.48, "isGap": true}
]
```

### auto_selected.json

```json
[72, 85, 120]  // Claude 分析生成的预选索引
```

---

## 配置

### 火山引擎 API Key

```bash
cd /Users/chengfeng/Desktop/AIos/剪辑Agent/.claude/skills
cp .env.example .env
# 编辑 .env 填入 VOLCENGINE_API_KEY=xxx
```

---
name: podcastcut:剪播客
description: 播客音频转录和AI深度语义分析。基于阿里云FunASR API，生成增强审查界面和自动剪辑。触发词：剪播客、处理播客、编辑音频
---

<!--
input: 音频文件 (*.mp3, *.wav, *.m4a) + 说话人信息
output: subtitles_words.json、semantic_deep_analysis.json、review_enhanced.html（动态播放器）、精剪版mp3
pos: 阿里云转录 + AI深度理解 + 增强审核 + 自动剪辑

架构守护者：一旦我被修改，请同步更新：
1. ../README.md 的 Skill 清单
2. /CLAUDE.md 路由表
3. CHANGELOG.md 更新日志
-->

# 剪播客 v5

> 阿里云FunASR API转录 + Claude深度语义分析 + 增强网页审核 + 自动剪辑 + 个性化偏好学习

## 快速使用

```
用户: 帮我剪这个播客，有3个说话人：麦雅、响歌歌、安安
用户: 处理一下这个播客音频 /path/to/audio.mp3，2个主播
用户: 编辑这个播客录音，说话人：主持人、嘉宾
```

**必需输入**：
1. 音频文件路径
2. **说话人数量**（2人、3人等）— **必须由用户提供，不可自行判断**
3. 说话人姓名

**⚠️ 执行前检查**：
- 如果用户未明确提供说话人数量，**必须询问用户**
- 不要尝试自己判断或猜测说话人数量
- 说话人数量设置错误会导致98.8% → 低准确度

## 输出目录结构

```
output/
└── YYYY-MM-DD_音频名/
    └── 剪播客/
        ├── 1_转录/                              # 转录原始数据
        │   ├── audio.mp3                        # 原始音频（转录用）
        │   ├── audio_seekable.mp3              # CBR 重编码（审查页面用，精确 seek）
        │   ├── audio_url.txt                    # 上传URL
        │   ├── aliyun_funasr_transcription.json # 阿里云转录结果
        │   ├── speaker_mapping.json             # 说话人映射
        │   └── subtitles_words.json             # 字级别转录（核心）
        ├── 2_分析/                              # Claude分析数据
        │   ├── sentences.txt                    # 句子分割
        │   ├── semantic_deep_analysis.json      # AI深度分析（5a段落级）
        │   ├── fine_analysis.json              # AI精剪分析（5b词/句级）
        │   ├── ANALYSIS_COMPLETE.md             # 分析报告
        │   ├── selected_default.json            # 默认删除建议
        │   └── delete_segments.json             # 时间段格式（5a+5b合并）
        ├── 3_成品/                              # 最终输出
        │   ├── 播客名_精剪版_v1.mp3
        │   ├── 播客名_精剪版_v2.mp3             # 重剪版本
        │   └── ...
        ├── review_enhanced.html                 # 审查界面
        └── server.log                           # 服务器日志（可选）
```

## 流程

```
-1. 用户识别 + 偏好确认 🆕v5
    → 识别用户（环境变量 / 询问）
    → 首次：Onboarding（播客链接 / 样本学习 / 手动问答）
    → 日常：读取用户偏好 + 确认本次需求
    → 加载用户级 editing_rules（基础规则 + 用户覆盖）
    ↓
0. 创建输出目录
    ↓
1. 提取/准备音频 (ffmpeg)
    ↓
2. 上传获取公网 URL (uguu.se)
    ↓
3. 转录 + 说话人映射 (subtitles_words.json)
    - 调用阿里云FunASR API（3分钟）
    - 识别说话人身份（前20句）
    - 创建speaker_mapping.json
    - 生成字级别转录
    ↓
4. 句子分割 (sentences.txt)
    ↓
5a. 内容分析（段落级）🔄v5 使用用户级规则
    - 通读全文，划分话题段落
    - 按用户 preferences 的 detect_types 开关识别删除类型
    - 参考用户 editing_rules/content_analysis.yaml 的激进度
    - 输出: semantic_deep_analysis.json
    ↓
5b. 精剪分析（词/句级）🔄v5 使用用户级规则
    - 检测：静音、残句、重复句、卡顿词、重说纠正、填充词
    - 按 用户习惯/ 基础规则 + editing_rules/ 用户覆盖
    - 输出: fine_analysis.json
    ↓
6. 生成增强审查界面 (review_enhanced.html)
    ↓
7. 用户审查 + 编辑 + 导出
    ↓
7b. 反馈学习 🆕v5
    - 如用户导出了 AI 反馈（ai_feedback_*.json）
    - 运行 analyze_feedback.js → 生成调整建议
    - 确认后 apply_feedback_to_rules.js → 更新 editing_rules
    ↓
8. 合并删除建议 + 精剪
    ↓
9. 一键剪辑生成精剪版
    ↓
9b. 自动质检 🆕v5（可选）
    - 如 preferences.workflow_automation.auto_qa_enabled
    - 自动跑 /podcastcut-质检
    ↓
10. 后期处理 🆕v5（可选）
    - 首次：确认后期偏好 → 存入 post_production.yaml
    - 后续：读取偏好 → 执行 /podcastcut-后期
    ↓
11. 最终交付
    - 汇总输出 + 保存 episode_history
    - 提醒导出反馈
```

## 执行步骤


### 步骤 -1: 用户识别 + 偏好确认 🆕v5

**⚠️ 这是整个流程的第一步。用户说"剪播客"时，必须先走这一步。**

**核心原则：主动引导，不要等用户猜你需要什么。像表单一样一步步带着走。**

#### 第一个问题：你是谁？

收到剪播客请求后，**立刻**问用户：

> "你是已有用户还是新用户？"

```bash
cd /Volumes/T9/claude_skill/podcastcut/剪播客

# 列出已有用户
node scripts/user_manager.js list
```

- **已有用户** → 询问用户名 → 加载偏好 → 跳到「日常使用」
- **新用户** → 询问用户名（英文/拼音）→ 创建用户 → 进入「Onboarding」

```bash
# 检查用户是否存在
node scripts/user_manager.js check <userId>

# 创建新用户（从 default/ 克隆配置）
node scripts/user_manager.js create <userId>
```

---

#### Onboarding（新用户）

**主动引导，按以下顺序逐步提问：**

**0. 播客链接（可选，优先）**
- 主动问："你有小宇宙或 Apple Podcasts 的链接吗？"
- 如有：运行 `node scripts/parse_podcast_link.js <url> <userId>`
- AI 自动提取播客名、描述、主题 → 写入 `podcast_profile.yaml`
- 后续受众/目的等问题可自动填充（用户确认即可）
- 如没有（如播客未上线）：跳过，后续手动填

**1. 剪辑样本学习（可选，推荐）**
- 主动问："你有以前剪辑过的音频样本吗？（剪辑前 + 剪辑后各一份）"
- 如有：
  1. 收集：原始音频路径 + 剪后音频路径 + 说话人数量
  2. 用阿里云转录两个版本
  3. 运行 `python3 scripts/analyze_editing_samples.py --before-transcript ... --after-transcript ... --output learned_patterns.json`
  4. 运行 `node scripts/generate_rule_overrides.js learned_patterns.json <userId>`
  5. AI 呈现提取的偏好，用户确认后保存到 `editing_rules/`
  6. **可跳过手动问答**（样本已提供足够信息）

**2. 播客定位 (首次必填)**
- 主动问受众、目的
- 如播客链接已提取信息，此处确认即可

**3. 时长偏好**
- 主动问理想时长（如 90 分钟）
- 主动问激进度：conservative（10-20%）/ moderate（20-35%）/ aggressive（35-50%）

**4. 内容逻辑偏好**
- 主动问是否启用 AI 内容分析
- 6 种删除类型各自开关：录前准备、技术调试、跑题闲聊、隐私信息、重复内容、制作讨论

**5. 技术细节偏好**
- 主动问口癖检测激进度、重复句处理、静音阈值

**6. 说话人信息**
- 主动问常用说话人姓名

**后期偏好延迟到首次使用后期 skill 时再询问。**

---

#### 日常使用（已有用户）

如果用户已存在，Claude 会：
1. 读取用户 `preferences.yaml` + `editing_rules/`
2. 简要确认："已加载你的偏好配置。"
3. **直接问**："你这次要剪什么播客？把音频文件给我，告诉我几个说话人。"
4. 拿到音频路径后立即 `ffprobe` 获取时长，与目标时长对比
5. 如果原始时长明显超出目标（如 147min vs 90min），**当场告知用户**："原始 XXX 分钟，目标 YYY 分钟，需要删掉约 ZZZ 分钟。5a 阶段会做内容精选（裁掉部分话题段落），不仅仅是删除有问题的内容。确认？"
6. 确认是否有特殊要求（如有，临时调整）

#### 偏好管理

```bash
# 用户管理
node scripts/user_manager.js list              # 列出所有用户
node scripts/user_manager.js create <userId>    # 创建新用户
node scripts/user_manager.js prefs <userId>     # 查看用户偏好
node scripts/user_manager.js rules <userId>     # 查看 editing rules

# 直接编辑
open 用户配置/<userId>/preferences.yaml          # 编辑意图层偏好

# 或告诉 Claude
# "更新我的默认时长为90分钟"
# "我现在偏好激进删减"
```

**偏好文件位置**：`/Volumes/T9/claude_skill/podcastcut/剪播客/用户配置/<userId>/`

---

### 步骤 0: 创建输出目录

```bash
# 变量设置（根据实际音频调整）——后续所有步骤都依赖这些变量
AUDIO_PATH="/path/to/播客.mp3"
AUDIO_NAME=$(basename "$AUDIO_PATH" | sed 's/\.[^.]*$//')
DATE=$(date +%Y-%m-%d)
SKILL_DIR="/Volumes/T9/claude_skill/podcastcut"
BASE_DIR="$SKILL_DIR/output/${DATE}_${AUDIO_NAME}/剪播客"

# 创建子目录
mkdir -p "$BASE_DIR/1_转录" "$BASE_DIR/2_分析" "$BASE_DIR/3_成品"
```

### 步骤 1: 准备音频

```bash
# 转换/复制原始音频用于转录
if [[ "$AUDIO_PATH" == *.mp3 ]]; then
  cp "$AUDIO_PATH" "$BASE_DIR/1_转录/audio.mp3"
else
  ffmpeg -i "file:$AUDIO_PATH" -vn -acodec libmp3lame -ar 16000 -ac 1 -y "$BASE_DIR/1_转录/audio.mp3"
fi

# ⚠️ 必须：重编码为 CBR MP3 供审查页面使用（精确 seek）
# VBR MP3 在浏览器中 seek 会随位置偏移越来越大，导致点击句子播放错位
ffmpeg -i "$BASE_DIR/1_转录/audio.mp3" -c:a libmp3lame -b:a 64k -write_xing 1 -y "$BASE_DIR/1_转录/audio_seekable.mp3"

echo "✅ 音频已准备: audio.mp3 (转录用) + audio_seekable.mp3 (审查页面用)"
```

> **审查页面必须使用 `audio_seekable.mp3`**。步骤 6 生成 HTML 时 `--audio` 参数传 `1_转录/audio_seekable.mp3`。

### 步骤 2: 上传获取公网URL

```bash
# 上传到uguu.se（24小时有效）
UPLOAD_RESPONSE=$(curl -s -F "files[]=@$BASE_DIR/1_转录/audio.mp3" "https://uguu.se/upload?output=text")

echo "✅ 音频已上传"
echo "   URL: $UPLOAD_RESPONSE"

# 保存URL供后续使用
echo "$UPLOAD_RESPONSE" > "$BASE_DIR/1_转录/audio_url.txt"
AUDIO_URL="$UPLOAD_RESPONSE"
```

**注意**：
- uguu.se文件24小时后自动删除
- 如需长期保存，使用阿里云OSS或其他云存储
- 确保URL可公网访问

### 步骤 3: 转录 + 说话人映射 → subtitles_words.json

本步骤完成：API转录 → 识别说话人 → 生成字级别转录

```bash
SPEAKER_COUNT=3  # ⚠️ 必须由用户提供（2人、3人等）

# 3a. 调用阿里云API转录（~3分钟）
# API Key 会自动从 .env 加载，无需手动 export
cd "$BASE_DIR/1_转录"
bash "$SKILL_DIR/剪播客/scripts/aliyun_funasr_transcribe.sh" "$AUDIO_URL" "$SPEAKER_COUNT"
# 生成: aliyun_funasr_transcription.json

# 3b. 识别说话人身份（查看前20句）
node "$SKILL_DIR/剪播客/scripts/identify_speakers.js" "$BASE_DIR/1_转录/aliyun_funasr_transcription.json"
# 输出示例：
# 1. [Speaker 0] 0.2s - 我是主播麦雅
# 2. [Speaker 1] 29.4s - Hello大家好，我是十一

# 3c. 根据输出创建映射
cat > "$BASE_DIR/1_转录/speaker_mapping.json" << 'EOF'
{
  "0": "麦雅",
  "1": "十一"
}
EOF

# 3d. 生成字级别转录（最终输出）
cd "$BASE_DIR/1_转录"
node "$SKILL_DIR/剪播客/scripts/generate_subtitles_from_aliyun.js" \
  aliyun_funasr_transcription.json \
  speaker_mapping.json
# 生成: subtitles_words.json ⭐核心文件

echo "✅ 步骤3完成：subtitles_words.json 已生成"
```

**关键点**：
- `SPEAKER_COUNT` 必须正确（98.8%准确度依赖此参数）
- `identify_speakers.js` 辅助工具帮助快速识别
- `subtitles_words.json` 是后续所有步骤的基础

### 步骤 4: 句子分割 (sentences.txt)

从字级别转录生成句子级别文本，方便后续分析。

```bash
# 调用句子分割脚本
cd "$BASE_DIR/2_分析"
node "$SKILL_DIR/剪播客/scripts/generate_sentences.js" "$BASE_DIR/1_转录/subtitles_words.json"

# 输出: sentences.txt
# 格式: 句子索引|词索引范围|说话人|文本内容
```

**输出示例**：
```
0|0-429|麦雅|哈喽大家好欢迎来到今天的五点一刻...
1|431-607|十一|啊对的嗯啊对现在已经26年了...
2|609-612|十一|啊对的嗯。
```

---

### 步骤 5a: Claude深度语义分析 🔄v5

> 详细方法论见 `用户习惯/10-内容分析方法论.md`

采用**两级分析**：先段落级扫描标记大块删除区间，再对边界逐句微调。

**🆕v5 用户级规则加载**：

分析前先加载用户偏好和规则覆盖：
```javascript
const UserManager = require('./scripts/user_manager');
const prefs = UserManager.loadPreferences(userId);
const rules = UserManager.loadEditingRules(userId);
// rules.user_overrides['content_analysis'] — 用户级激进度覆盖（如有）
```
- 按 `prefs.content_analysis.detect_types` 的开关决定启用哪些删除类型
- 按 `prefs.duration.aggressiveness` 或 `rules.user_overrides.content_analysis.aggressiveness` 决定激进度
- **优先级**：editing_rules 覆盖 > preferences 意图 > 基础规则默认值

**流程**：
1. 通读 `sentences.txt` 全文，划分话题段落
2. 根据用户 `detect_types` 开关，识别启用的删除类型（见下方类型表）
3. 计算各块时长，对比目标时长缺口
4. 如仍需删减，按用户激进度识别信息密度低的段落（标记为 `delete`）
5. **质量优化扫描（始终执行，即使无时长缺口）**：按 `10-内容分析方法论.md` 的"质量优化分析"章节，扫描啰嗦重复/过度展开/信息密度低/弱相关细节，标记为 `suggest_delete`
6. 微调每个删除块的边界切点
7. 生成 `semantic_deep_analysis.json`

**6种删除类型**：

| 类型     | 标识               | 说明                                   |
| -------- | ------------------ | -------------------------------------- |
| 录前准备 | `pre_show`         | 正式开场白之前的一切内容               |
| 技术调试 | `tech_debug`       | 设备问题、录制中断、音频检查           |
| 跑题闲聊 | `chit_chat`        | 与主题无关的闲聊（等待时的寒暄等）     |
| 隐私信息 | `privacy`          | 说话人明确要求删除、或涉及敏感个人信息 |
| 重复内容 | `repeated_content` | 同一段故事讲了两遍（保留简版，删详版） |
| 制作讨论 | `production_talk`  | 录制中讨论剪辑策略、什么要保留/删除    |

**生成文件**：`semantic_deep_analysis.json`

**格式**（两级结构）：
```json
{
  "version": "5.0",
  "analysisType": "two_level",
  "totalDuration": "2:08:06 (128min)",
  "targetDuration": "90min",
  "blocks": [
    {
      "id": 1,
      "range": [0, 19],
      "type": "pre_show",
      "reason": "录前准备：测噪音、谁先开口、打开文档",
      "duration": "1:06"
    }
  ],
  "sentences": [
    { "sentenceIdx": 0, "speaker": "响歌歌", "action": "delete", "blockId": 1, "type": "pre_show" },
    { "sentenceIdx": 20, "speaker": "麦雅", "action": "keep" }
  ],
  "summary": {
    "totalSentences": 1404,
    "deleteSentences": 227,
    "deleteBlocks": 13,
    "totalDeleteDuration": "14:23",
    "deleteRatio": "16.2%"
  }
}
```

**关键设计**：
- `blocks` — 段落级，供人工审核（看大块删了什么）
- `sentences` — 逐句级，供下游脚本消费（`generate_default_selection.js` 兼容）
- 删除句的 `action` 为 `"delete"`，保留句为 `"keep"`

---

### 步骤 5b: 精剪分析（词/句级）🔄v5

> 基础规则见 `用户习惯/` 目录下的 1-9 号文件（全局共享）
> 用户覆盖见 `用户配置/<userId>/editing_rules/`（个性化参数）

步骤 5 删大块（内容级），步骤 5b 删口癖和语病（词/句级）。两步的结果合并后送入审查界面。

**🆕v5 规则合并机制**：

```
最终规则 = 基础规则（用户习惯/）+ 用户覆盖（editing_rules/）
```
- **基础规则**（`用户习惯/1-9.md`）：所有用户共享的检测方法论和默认阈值
- **用户覆盖**（`editing_rules/*.yaml`）：来自样本学习或反馈闭环的个性化参数
  - `filler_words.yaml` — 每个填充词的删除率（如"嗯" 85%、"啊" 55%）
  - `silence.yaml` — 自定义静音阈值（如 2.5s）
  - `stutter.yaml` — 卡顿检测额外模式
- 如果用户覆盖存在同名参数，优先使用用户覆盖的值

**分析对象**：步骤 5 中标记为 `keep` 的句子（已删的不再分析）

**按优先级依次检测**（规则详见 `用户习惯/README.md`）：

| 优先级 | 类型       | 规则文件       | 说明                                    |
| ------ | ---------- | -------------- | --------------------------------------- |
| 1      | 长静音     | 3-静音段处理   | >2s 建议删，>5s 必删                    |
| 2      | 残句       | 9-残句检测     | 话说一半被打断，整句删                  |
| 3      | 重复句     | 4-重复句检测   | 相邻句开头≥5字相同，删短的              |
| 4      | 句内重复   | 6-句内重复检测 | A+填充+A 模式，删前面的A                |
| 5      | 卡顿词     | 5-卡顿词       | "那个那个"等重复词，删前面（排除叠词+播客自然重复+高频口语词组） |
| 6      | 重说纠正   | 8-重说纠正     | 说错立刻纠正，删错的                    |
| 7      | 连续填充词 | 7-连续填充词   | "嗯啊"、"呃啊"，全删                    |
| 8      | 单个填充词 | 2-填充词检测   | 单个"嗯"/"啊"默认保留（播客保持对话感） |

**核心原则**（`用户习惯/1-核心原则.md`）：
- **删前保后**：后说的通常更完整
- **播客特殊**：思考停顿保留，对话反应时间保留，填充词适度保留

**流程（混合架构：规则层 + LLM 层）**：

```
Step 5b = 规则层 + LLM 层 → 合并 → fine_analysis.json

规则层 (run_fine_analysis.js → fine_analysis_rules.json):
  - 静音检测（需要音频时间戳，LLM 做不了）
  - 基础卡顿词（连续相同词，确定性 pattern）

LLM 层 (Claude 当前会话 → fine_analysis_llm.json):
  - 句首填充词（语义判断删/留）
  - 重说纠正（需要理解语义）⚠️ 漏检率最高的类型，务必仔细检查
    → 详见 用户习惯/8-重说纠正.md 的 8 种子模式 + LLM 自查清单
    → 重点关注：粒子结尾 false start、同头扩展、近义重述
  - 句内重复（A+中间字+A）
  - 残句检测（判断完整性）
  - 单句填充词（"嗯。""啊。"等纯填充句）
  - 连续填充词的语义判断
  - 录制讨论（production talk）

合并 (merge_llm_fine.js → fine_analysis.json):
  LLM 文本标记 → 映射回词级时间戳 → 与规则层去重合并
```

1. **规则层**：运行 `run_fine_analysis.js` → `fine_analysis_rules.json`
2. **LLM 层**：Claude 分批读取 `sentences.txt`（~150句/批），输出 JSON 编辑标记 → `fine_analysis_llm.json`
3. **合并**：运行 `merge_llm_fine.js` → `fine_analysis.json`（最终合并去重版本）

**LLM 层输出格式**：
```json
[
  {"s": 27, "text": "然后", "type": "filler_start", "reason": "句首口癖"},
  {"s": 96, "text": "我，因为我，infj 是一个，我是，", "type": "self_correction", "reason": "重说纠正"}
]
```

**输出文件**：`fine_analysis.json`

```json
{
  "edits": [
    {
      "sentenceIdx": 2,
      "type": "stutter",
      "rule": "5-卡顿词",
      "wordRange": [25, 26],
      "deleteText": "那那那次",
      "keepText": "那次",
      "reason": "连续重复词，保留最后一次"
    },
    {
      "sentenceIdx": 85,
      "type": "silence",
      "rule": "3-静音段处理",
      "wordRange": [915, 915],
      "duration": 3.2,
      "reason": "静音3.2秒，超过2秒阈值"
    }
  ],
  "summary": {
    "totalEdits": 47,
    "byType": {
      "silence": 12,
      "residual_sentence": 3,
      "repeated_sentence": 5,
      "in_sentence_repeat": 8,
      "stutter": 7,
      "self_correction": 4,
      "consecutive_filler": 6,
      "single_filler": 2
    },
    "estimatedTimeSaved": "2:30"
  }
}
```

**与步骤 5 的关系**：
- 步骤 5 产出 `semantic_deep_analysis.json`（段落级，删大块）
- 步骤 5b 产出 `fine_analysis.json`（词/句级，删口癖）
- 两者独立生成，在步骤 6 审查界面中合并展示，用户在步骤 7 手动编辑后导出 `delete_segments_edited.json`

---

### 步骤 6: 生成增强审查界面

生成 `review_enhanced.html`，提供可视化审核 + 实时试听 + 交互编辑。

**输入文件**：
- `subtitles_words.json` — 词级时间戳（核心数据源）
- `sentences.txt` — 句子分割
- `semantic_deep_analysis.json` — 5a 段落级分析
- `fine_analysis.json` — 5b 精剪分析
- `1_转录/audio.mp3`（或 `audio_seekable.mp3`）— 原始音频

**⚠️ 生成 HTML 时的关键规范**：

**1. 词索引映射（必须正确）**：
```
sentences.txt 的词索引 → actual_words（跳过 isGap 和 isSpeakerLabel）
actual_words = words.filter(w => !w.isGap && !w.isSpeakerLabel)
❌ 错误：words[wordIdx]（包含 gap/label 的全数组）
✅ 正确：actual_words[wordIdx]
```
> 此 bug 曾导致所有句子 startTime 偏移约 25 秒

**2. sentencesData 结构（每句必须包含）**：
```json
{
  "idx": 0,
  "speaker": "麦雅",
  "text": "句子文本...",
  "startTime": 69.4,
  "endTime": 74.8,
  "timeStr": "1:09",
  "words": [{"t": "大家", "s": 69.5, "e": 69.7}, ...],
  "isAiDeleted": true,
  "deleteType": "pre_show",
  "fineEdit": {
    "idx": 0, "type": "stutter", "deleteText": "那那",
    "keepText": "那", "reason": "...",
    "ds": 69.5, "de": 69.6
  }
}
```
- `endTime` = 下一句的 startTime（最后一句用最后一个词的 end）
- `words` = 该句所有词的时间戳（用于手动编辑的文本→时间映射）
- `fineEdit.ds` / `fineEdit.de` = 精剪删除文本的起止时间（预计算）

**3. 精剪播放器 — 动态跳过（不用预剪文件）**：
```
原理：播放原始音频，实时计算并跳过所有标记删除的时间段
数据源：currentDeletedSet（句子级）+ fineEdits（词级）+ manualEdits（手动）
优点：任何编辑即时生效，无需重新生成音频
```
- `getSkipRanges()` — 从当前编辑状态动态计算删除时间段
  - 每个 range 附带自适应 lookahead `[start, end, lookahead]`
  - 句间 gap 大（~1s）→ lookahead 300ms；句内 gap 小（~0ms）→ 50ms
  - 紧密间隙（gap < 200ms）时 range 起点前移 200ms，防 JS 延迟泄漏
  - 首个 range 如起点 < 5s，自动扩展到 0（清除录前杂音）
- `skipIfNeeded()` — pause → seek → play（非 muted，彻底切断输出）
  - ❌ 不用 `audio.muted`（缓冲延迟泄漏）
  - ❌ 不用 Web Audio API GainNode（file:// CORS 限制）
  - `seekTarget = e`（精确落点，不加偏移，避免切掉保留词首字）
  - 仅当 nextKept.startTime 在 e 的 0.5s 内才使用（防精剪跳过整句）
- `originalToVirtual()` / `virtualToOriginal()` — 原始⟷虚拟时间互转
- 进度条显示虚拟时间线（自动扣除已删除时长）

**4. 交互编辑功能**：

| 功能          | 操作                        | 说明                                                     |
| ------------- | --------------------------- | -------------------------------------------------------- |
| 整句删除/恢复 | 点击勾选框                  | 切换句子删除状态                                         |
| AI 精剪切换   | 点击划线文字或橙色标签      | 切换词级精剪                                             |
| 手动半句删除  | 鼠标选中文字 → 点"标记删除" | 浮动工具栏；也可按 Delete/Backspace 键                   |
| 修正说话人    | 点击说话人名字              | 弹出下拉选择已有说话人或输入新名字                       |
| 点击跳转音频  | 点击任意句子行              | 两个播放器都跳转                                         |
| 撤销          | Ctrl+Z                      | 所有操作可撤销                                           |
| 导出剪辑文件  | 点击"导出剪辑文件"(绿色)    | `delete_segments_edited.json`，可直接用于 `cut_audio.py` |
| 导出AI反馈    | 点击"导出AI反馈"(蓝色)      | 在统计区域下方，用于反馈 AI 标记准确度                   |

**5. 音频文件**：
- **必须使用 `audio_seekable.mp3`**（Step 1 已自动生成 CBR 64k + Xing header）
- VBR MP3 在浏览器中 seek 会渐进式漂移，导致后半段点击句子播放错位
- HTML 的 `<audio>` 使用 `preload="auto"` 加速定位

**6. 内容删减概览（Summary Table）**：
- 页面顶部自动生成可折叠的概览表，列出所有删除段落
- 每行显示：话题、类型标签、时间位置（可点击跳转）、时长、删减理由
- 支持整段勾选/取消，footer 实时更新（原始总时长 / 段落删减 / 总删减 / 预计剩余）

**生成命令**：
```bash
cd "$BASE_DIR/2_分析"

# 生成审查 HTML（audio_seekable.mp3 已在 Step 1 生成）
node "$SKILL_DIR/剪播客/scripts/generate_review_enhanced.js" \
  --sentences sentences.txt \
  --words "$BASE_DIR/1_转录/subtitles_words.json" \
  --analysis semantic_deep_analysis.json \
  --fine fine_analysis.json \
  --audio "1_转录/audio_seekable.mp3" \
  --output "$BASE_DIR/review_enhanced.html" \
  --title "播客审查稿 (可编辑)"

# 打开审查页面
open "$BASE_DIR/review_enhanced.html"
```

> 模板位于 `templates/review_enhanced.html`，脚本自动注入数据。
> 如果没有 `fine_analysis.json`（跳过了步骤 5b），脚本会自动忽略精剪数据。

---

### 步骤 7: 审查、编辑、导出

打开审查页面，审核 AI 建议，进行手动编辑，导出剪辑文件。

```bash
open "$BASE_DIR/review_enhanced.html"
```

**操作流程**：
1. 浏览所有句子和 AI 建议（删除标记、精剪标记）
2. 用精剪播放器试听效果
3. 手动调整：
   - 勾选/取消勾选：标记或恢复删除
   - 点击精剪标签：启用/禁用词级精剪
   - 选中文字 → "标记删除"：手动半句删除
4. 编辑会**自动保存到浏览器 localStorage**，刷新页面不丢失
5. 点击绿色"导出剪辑文件"→ 下载 `delete_segments_edited.json`
6. 将文件复制到 `2_分析` 目录

**自动保存**：
- 每次编辑后 500ms 自动保存到 localStorage（按页面标题区分不同播客）
- 刷新页面自动恢复：删除标记、精剪开关、手动编辑、AI 遗漏反馈
- 30 天后自动清理旧数据
- 保存成功时右上角显示"✓ 已自动保存"

**导出文件**：
- "导出剪辑文件"（绿色）→ `delete_segments_edited.json` — 包含所有手动修改的删除时间段，直接用于剪辑
- "导出修改"→ `review_modifications_*.json` — 编辑状态备份（可选）

**导出范围的精度补偿**：
- 范围起点：紧密间隙处前移 50ms（ASR 时间戳补偿）
- 范围终点：seekTarget 对齐（snap 到下一保留句起点，与播放器听感一致）
- 首段扩展：第一个删除段在前 5 秒内自动扩展到 0

---

### 步骤 7b: 反馈学习 🆕v5

**用户审查修正 → 自动分析 → 更新 editing_rules**

审查页已有"导出 AI 反馈"按钮（蓝色），导出 `ai_feedback_*.json`，包含：
- `missed_catches` — AI 遗漏（用户手动标记的删除）
- `user_corrections.added_deletions` — 用户新增的删除
- `user_corrections.removed_deletions` — 用户撤销 AI 删除的

**触发条件**：检测到 `2_分析/` 目录下有 `ai_feedback_*.json` 文件

**流程**：
```bash
cd "$BASE_DIR/2_分析"

# 1. 分析反馈
node "$SKILL_DIR/剪播客/scripts/analyze_feedback.js" \
  ai_feedback_*.json \
  feedback_analysis.json \
  fine_analysis.json

# 2. 呈现调整建议给用户确认
cat feedback_analysis.json
# → 显示建议（如：降低"嗯"删除激进度、提高静音阈值等）

# 3. 用户确认后，应用到 editing_rules
node "$SKILL_DIR/剪播客/scripts/apply_feedback_to_rules.js" \
  feedback_analysis.json \
  <userId>
```

**反馈 → 规则映射**：

| 反馈类型 | 更新目标 | 示例 |
|----------|----------|------|
| 用户恢复填充词删除 | `editing_rules/filler_words.yaml` | 降低激进度 |
| 用户恢复静音删除 | `editing_rules/silence.yaml` | 提高阈值 |
| 用户恢复内容块删除 | `editing_rules/content_analysis.yaml` | 降低激进度 |
| AI 遗漏卡顿词 | `editing_rules/stutter.yaml` | 新增模式 |

**学习规则**：
- 置信度 ≥ 0.5 才生成调整建议
- 所有调整必须经用户确认后写入
- 记录到 `learning_history.json`

---

### 步骤 8: 一键剪辑生成精剪版

使用 FFmpeg 剪辑音频。先解码为 WAV 确保采样级精确切割。

```bash
cd "$BASE_DIR/2_分析"

python3 "$SKILL_DIR/剪播客/scripts/cut_audio.py" \
  "$BASE_DIR/3_成品/${AUDIO_NAME}_精剪版_v1.mp3" \
  "$BASE_DIR/1_转录/audio.mp3" \
  delete_segments_edited.json \
  --speakers-json "$BASE_DIR/1_转录/subtitles_words.json"
```

> `--speakers-json` 默认始终传入。脚本自动检测音量差异，< 0.5dB 时跳过补偿，无副作用。

**输出**：
- `3_成品/播客名_精剪版_v1.mp3`
- 如需调整：回到步骤 7 修改 → 重新导出 → 重新执行

**剪辑特点**：
- ✅ WAV 中间格式，采样级精确（无 MP3 帧边界偏移）
- ✅ 自适应淡入淡出：每个切点自动加 fade，消除断句感
  - 时长 = `clamp(片段时长 × 8%, 0.03s, 0.3s)`，首尾段不加
- ✅ 说话人音量对齐（`--speakers-json`）：检测各说话人平均响度，自动补偿差异（最大 +6dB）
- ✅ 连续删除句自动分组，无碎片
- ✅ 重编码确保精确 seek
- ✅ 显示节省时间统计

**⚠️ 必须使用 `cut_audio.py`**：不要手写 FFmpeg 命令或自行实现剪辑逻辑。见陷阱 17。

---

### 步骤 8b: 成品静音裁剪 🆕

剪辑成品后，删除内容前后的短静音会合并成超阈值的长停顿。**必须在成品上再扫一遍。**

**为什么不在 delete_segments 阶段处理？**
- 用户手动编辑（恢复/删除）会产生新的合并间隙
- merge_llm_fine.js 的 post-merge gap cleanup 是基于预测的，不够精确
- **直接在成品音频上用 FFmpeg silencedetect 扫描最简单可靠**

```bash
python3 "$SKILL_DIR/剪播客/scripts/trim_silences.py" \
  "$BASE_DIR/3_成品/${AUDIO_NAME}_精剪版_v1.mp3"
# 默认: 检测 >0.8s 静音，裁剪到 0.6s
# 输出: *_trimmed.mp3

# 自定义参数:
python3 "$SKILL_DIR/剪播客/scripts/trim_silences.py" \
  input.mp3 output.mp3 \
  --threshold 0.8 \   # 检测阈值
  --target 0.6 \      # 每段静音保留的目标时长
  --noise -30          # silencedetect 噪声阈值 dB
```

**关键设计**：
- target 比 threshold 低 0.2s（保留 0.3+0.3=0.6s），因为 silencedetect 边界检测和裁切点不完全对齐（见陷阱 24）
- 独立脚本，不依赖 delete_segments，任何 MP3 都能跑
- 可迭代：用户不满意可以调参数重跑

---

```
步骤-1: 用户识别 + 偏好确认 🆕v5
步骤0:  创建目录
步骤1:  准备音频
步骤2:  上传URL
步骤3:  转录+说话人映射 → subtitles_words.json ⭐
步骤4:  句子分割 → sentences.txt
步骤5a: 内容分析（段落级）→ semantic_deep_analysis.json ⭐ (用户级规则)
步骤5b: 精剪分析（词/句级）→ fine_analysis.json ⭐ (基础规则+用户覆盖)
步骤6:  生成审查界面 → review_enhanced.html ⭐
步骤7:  审查+编辑+导出 → delete_segments_edited.json ⭐
步骤7b: 反馈学习 🆕v5 → 更新 editing_rules/
步骤8:  剪辑 → 播客名_精剪版_v1.mp3
步骤8b: 成品静音裁剪 🆕 → 播客名_精剪版_v1_trimmed.mp3 🎉
步骤9b: 自动质检 🆕v5（可选）→ QA 报告
步骤10: 后期处理 🆕v5（可选）→ 片头/时间戳/标题
步骤11: 最终交付 🆕v5 → episode_history + 汇总
```

**用户交互点**：
- 步骤-1：首次使用 Onboarding / 日常确认偏好
- 步骤3后：确认说话人映射
- 步骤7：在浏览器中审核 AI 建议、手动编辑、导出剪辑文件
- 步骤7b：确认反馈学习的规则调整建议
- 步骤8后：试听精剪版，如需调整回到步骤7

---

### 步骤 9b: 自动质检 🆕v5（可选）

**条件**：`preferences.yaml` 中 `workflow_automation.auto_qa_enabled: true`

剪辑完成后自动触发质检 skill，检查剪切点的音频质量问题。

```bash
# 自动触发 /podcastcut-质检
# 输入：精剪版音频 + delete_segments_edited.json
# 输出：QA 报告（能量突变、静音异常、频谱跳变）
```

**流程**：
1. 读取 `preferences.yaml` 检查 `auto_qa_enabled`
2. 如启用，自动调用 `/podcastcut-质检` skill
3. 如有问题标记，呈现给用户
4. 用户决定是否回到步骤 7 调整

---

### 步骤 10: 后期处理 🆕v5（可选）

**条件**：`preferences.yaml` 中 `workflow_automation.auto_post_production` 控制是否自动触发

**首次使用后期**：
1. 询问后期偏好（片头音乐、时间戳格式、标题风格等）
2. 保存到 `用户配置/<userId>/post_production.yaml`
3. 执行 `/podcastcut-后期` skill

**后续使用**：
1. 读取 `post_production.yaml`
2. 确认本次是否有调整
3. 执行 `/podcastcut-后期` skill

```bash
# 读取后期偏好
node -e "
  const um = require('$SKILL_DIR/剪播客/scripts/user_manager');
  const pp = um.loadPostProduction('$PODCASTCUT_USER');
  console.log(JSON.stringify(pp, null, 2));
"

# 触发后期 skill
# → 高亮片段预览、片头背景音乐、时间戳章节、标题建议、播客简介
```

---

### 步骤 11: 最终交付 🆕v5

**汇总所有输出 + 记录到 episode_history**

**流程**：
1. 汇总本次处理的所有产出物：
   - 精剪版音频（步骤 8）
   - QA 报告（步骤 9b，如有）
   - 后期产物（步骤 10，如有）
2. 记录到 `episode_history.json`：
   ```bash
   node -e "
     const um = require('$SKILL_DIR/剪播客/scripts/user_manager');
     um.appendEpisode('$PODCASTCUT_USER', {
       audio_file: '原始文件名',
       original_duration_min: 128,
       final_duration_min: 92,
       delete_ratio: '28%',
       content_blocks_deleted: 13,
       fine_edits: 47,
       qa_issues: 0,
       post_production: true
     });
   "
   ```
3. 如 `preferences.yaml` 中 `workflow_automation.prompt_for_feedback: true`：
   - 提醒用户："如果你在审查时有修正 AI 的建议，记得在审查页导出 AI 反馈（蓝色按钮），下次剪辑时系统会自动学习。"

---

## 配置

### 阿里云API Key

```bash
# 方法1：环境变量
export DASHSCOPE_API_KEY="sk-your-api-key"

# 方法2：.env文件
cd /Volumes/T9/claude_skill/podcastcut
cat >> .env << 'EOF'
DASHSCOPE_API_KEY=sk-your-api-key
EOF
```

**获取API Key**：
1. 访问：https://dashscope.console.aliyun.com/
2. 开通"模型服务灵积"
3. 创建API Key

**价格参考**：
- 按音频时长计费
- 约¥X/小时（查看阿里云官网最新价格）

### 说话人数量确认

**如何确定说话人数量**：
1. 听前2-3分钟音频
2. 或查看节目大纲
3. 计算：主播数 + 嘉宾数 = 说话人总数

**示例**：
- 单人播客：1人
- 双人播客：2人
- 访谈节目（2主播+1嘉宾）：3人
- 多人圆桌：根据实际人数

**重要**：设置错误会导致说话人识别不准确！

---

## 数据格式

### aliyun_funasr_transcription.json

```json
{
  "transcripts": [{
    "sentences": [
      {
        "sentence_id": 1,
        "speaker_id": 0,
        "text": "嗯，哈喽，大家好，我是主播麦雅。",
        "begin_time": 69400,
        "end_time": 74800,
        "words": [
          {
            "text": "嗯",
            "begin_time": 69400,
            "end_time": 69600,
            "punctuation": "，"
          }
        ]
      }
    ]
  }]
}
```

### speaker_mapping.json

```json
{
  "0": "麦雅",
  "1": "响歌歌",
  "2": "安安"
}
```

### subtitles_words.json

```json
[
  {"text": "[麦雅]", "start": 69.4, "end": 69.4, "isGap": false, "isSpeakerLabel": true, "speaker": "麦雅"},
  {"text": "大家", "start": 69.5, "end": 69.7, "isGap": false, "speaker": "麦雅"},
  {"text": "", "start": 70.5, "end": 71.2, "isGap": true}
]
```

---

## 播客剪辑建议

与视频口播的关键区别：

1. **静音阈值**：
   - 视频：0.3-0.5秒
   - 播客：1-2秒（保留自然节奏）

2. **填充词处理**：
   - 视频：积极删除
   - 播客：适度保留（保持对话感）

3. **重复处理**：
   - 视频：严格删除
   - 播客：明显重复才删，轻微重复保留

4. **对话特性**：
   - 多人对话：保留反应时间和自然停顿
   - 单人播客：可以更紧凑，但不要过度

5. **专业术语**：
   - 确保词典包含所有专业术语
   - 人名、公司名要特别注意

---

## FAQ

### Q1: 阿里云API vs 本地FunASR如何选择？

**推荐阿里云API**：
- ✅ 速度快7倍（3分钟 vs 20分钟）
- ✅ 说话人识别准确（98.8%）
- ✅ 无需安装本地环境
- ✅ 适合偶尔使用或追求速度

**选择本地FunASR**：
- ✅ 完全免费
- ✅ 数据隐私（不离开本地）
- ✅ 适合大量频繁使用
- ✅ 准确度稍高（99%+）

### Q2: 说话人识别不准确怎么办？

**检查**：
1. `SPEAKER_COUNT` 是否设置正确？
2. 音频质量是否清晰？
3. 说话人声音是否差异明显？

**如果仍不准确**：
- 使用本地FunASR（准确度更高）
- 或人工校对（差异通常<2%，校对工作量小）

### Q3: uguu.se链接24小时后过期怎么办？

**解决方案**：
1. 使用阿里云OSS（推荐，长期有效）
2. 使用七牛云、腾讯云COS
3. 自己的服务器

**阿里云OSS示例**：
```bash
# 上传
ossutil cp audio.mp3 oss://your-bucket/podcast.mp3

# 生成带签名的公网URL（7天有效）
ossutil sign oss://your-bucket/podcast.mp3 --timeout 604800
```

### Q4: 如何批量处理多个播客？

**批处理脚本**：
```bash
for audio in /path/to/podcasts/*.mp3; do
  echo "处理: $audio"
  # 调用剪播客skill
  # 自动执行步骤0-5
done
```

### Q5: 成本估算？

**阿里云FunASR API**：
- 按音频时长计费
- 约¥X/小时（查看官网最新价格）
- 2小时播客约¥X

**uguu.se**：
- 完全免费
- 文件<100MB
- 24小时自动删除

---

## 版本历史

### v5.0 (2026-02-21)
- 🧑‍💼 Per-user 偏好系统：用户配置文件夹 + YAML 格式
- 🎓 新用户 Onboarding：播客链接解析 + 剪辑样本学习 + 扩展偏好问答
- 🔄 两层规则架构：preferences.yaml（意图层）→ editing_rules/（执行层）
- 📊 反馈闭环：审查修正自动分析 → editing_rules 更新
- 🤖 自动质检 + 后期触发 + episode_history 记录
- 📂 用户管理模块：user_manager.js（CRUD + 偏好读写）

### v4.1 (2026-02-12)
- 🎯 动态播放器跳过精度优化：自适应 lookahead + 紧密间隙前移 + pause-seek-play
- 🔧 修复精剪 seekTarget 跳过整句问题（nextKept 距离检查）
- 🔧 修复首段 0-1.36s 未跳过问题（getSkipRanges 首段扩展到 0）
- 🔧 修复 seekTarget +0.05 偏移切掉保留词首字问题

### v4.0 (2026-02-08)
- 🚀 切换到阿里云FunASR API
- ⚡ 速度提升7倍（3分钟 vs 20分钟）
- 🎯 说话人识别98.8%准确度（实测）
- 📝 新增说话人识别辅助工具
- 🔧 简化配置流程

### v3.0
- 🧠 Claude深度语义分析
- 🗑️ 删除线标注
- 🎯 智能删减建议
- 🤖 一键剪辑

### v2.0
- 火山引擎API转录
- 说话人分离

### v1.0
- 基础转录和剪辑

---

**推荐工作流**：阿里云API转录 + Claude分析 + 增强审核 + 一键剪辑 ✨

---

## 技术陷阱备忘

> 踩过的坑，避免重复犯错。

### 陷阱 1: subtitles_words.json 双索引问题

`subtitles_words.json` 包含三种条目：实际词、静音间隙（`isGap: true`）、说话人标签（`isSpeakerLabel: true`）。

`sentences.txt` 的词索引范围指的是**跳过 gap 和 label 后的实际词索引**。

```python
# ✅ 正确：过滤后的数组
actual_words = [w for w in words if not w.get('isGap') and not w.get('isSpeakerLabel')]
time = actual_words[word_idx]['start']

# ❌ 错误：全数组（偏差约 25 秒）
time = words[word_idx]['start']
```

### 陷阱 2: 连续句分组（convert_to_segments.js）

**问题**：逐句生成删除段 + 固定阈值合并 → 大块删除区内句间停顿变成音频碎片。

**正确做法**：先将连续删除句子索引分组（如 0,1,2,...,19 为一组），每组生成一整段 `[groupStart.startTime, groupEnd.endTime]`。

### 陷阱 3: MP3 拼接缺少 seek 索引

`ffmpeg -c copy` 拼接的 MP3 缺少 Xing/LAME 头，浏览器 seek 不精确。拼接后必须重编码：
```bash
ffmpeg -i concat.mp3 -c:a libmp3lame -b:a 64k output.mp3
```

### 陷阱 4: 首段扩展到 0

如果第一个删除段起点在前 5 秒内，`getSkipRanges()`（动态播放器）和 `merge_fine_edits.js`（静态剪辑）都自动扩展到 0，避免开头碎音。

### 陷阱 5: 精剪 seekTarget 不能跳到下一句

精剪是句内部分删除。seekTarget 用 `sentencesData.find(ns => ns.startTime >= e)` 查找下一个保留句时，
当前句的 `startTime` < `e`（因为删除范围在句中间），所以会跳到**下一句**（可能远在几秒后），
导致当前句中删除范围之后的保留内容全部被跳过。

**真实案例**：句 22 精剪删除 `[85.06, 87.34]`，保留文本 "和大家都很关心的经常发生的BURN OUT相关" 在 `87.5-91.18`，
但 seekTarget 跳到了句 23 的 `startTime = 92.76`，5.4 秒保留内容全被跳过。

**正确做法**：只有 `nextKept.startTime <= e + 0.5` 时才使用，否则 `seekTarget = e`。

### 陷阱 6: 动态播放器跳过精度

HTML5 audio 的 `currentTime` seek 不是帧级精确（MP3 每帧 ~26ms），且 JS 定时器有 50-100ms 延迟。
需要三层防护确保无残音：

**6a. 自适应 lookahead**

每个 skip range 根据前一个保留词的 end 时间计算安全提前量（在 `getSkipRanges()` 中计算）：

```javascript
// 找到 range start 之前最近的保留词结束时间
const gap = rangeStart - closestPrevWordEnd;
// 句间 gap 大(~1s) → 300ms; 句内 gap 小(~0ms) → 50ms
range[2] = Math.min(0.30, Math.max(0.05, gap));
```

**6b. 紧密间隙 range 前移（分层缓冲）**

精剪删除紧挨保留词时，skip range 起点向前扩展，防止删除内容起音泄漏：

```javascript
if (gap < 0.02) {
  // 零间隙（词边界）：前移 100ms — 防止声母/起音泄漏
  merged[i][0] = Math.max(0, merged[i][0] - 0.10);
} else if (gap < 0.10) {
  // 窄间隙：前移 50ms
  merged[i][0] = Math.max(0, merged[i][0] - 0.05);
}
```

**真实案例**：句 143 "方面的" 结束于 992.59，"困扰"(删) 开始于 992.59（gap=0）。
前移后 range 从 `[992.59, ...]` 变为 `[992.49, ...]`，防止"困"的起音泄漏。

**6c. mute → seek → fast-restore**

统一使用 mute 方式跳过（不 pause，避免 seeked 事件不触发）：

```javascript
audio.volume = 0;
audio.currentTime = seekTarget;
const resume = () => {
  audio.volume = savedVol * 0.3;         // 先 30% 音量
  setTimeout(() => { audio.volume = savedVol; }, 20); // 20ms 后恢复
  scheduleNextSkip();
};
audio.addEventListener('seeked', resume, { once: true });
setTimeout(resume, 80); // 激进 fallback（80ms，原 200ms）
```

- 快速 fade-in（20ms）避免 click 音
- 80ms fallback 减少句子级跳过的感知停顿（原 200ms 太长）

尝试过的失败方案：
- ❌ `audio.muted = true` — 有音频缓冲延迟，几 ms 已解码音频继续输出
- ❌ Web Audio API `GainNode` — 本地 `file://` 协议有 CORS 限制
- ❌ `seekTarget = e + 0.05` — 跳过保留词首字 50ms（如"放到"的"放"声母被切）
- ❌ pause → seek → play — pause 有时导致 seeked 事件不触发，音频卡住
- ❌ fallback 200ms — 句子级跳过时停顿感明显
- ✅ 条件策略 — 紧密间隙用 pause（防泄漏），宽间隙直接 seek（无 click）

**6d. seekTarget 精确落点**

- `seekTarget = e`（删除范围的精确结束点），**不加任何偏移**
- 只有当 `nextKept.startTime <= e + 0.5` 时才用 nextKept.startTime（见陷阱 5）

### 陷阱 8: 导出剪辑文件不能用播放器 skip ranges

`getSkipRanges()` 的范围包含 200ms 前移和 adaptive lookahead（补偿 JS 定时器延迟）。
导出给 `cut_audio.py` 的 `delete_segments_edited.json` 必须用**干净的合并范围**（无 nudge/lookahead），因为 ffmpeg 在 PCM 采样级别精确切割。

### 陷阱 9: 浏览器无法直接生成 MP3

- `fetch('file://...')` → CORS 拒绝
- `createMediaElementSource` → file:// CORS，完全无声
- Web Audio API 解码 + lamejs → 2 小时播客需 ~1GB 内存

**结论**：HTML 导出 JSON，用户运行 `python3 cut_audio.py` 生成最终音频。

### 陷阱 10: FFmpeg `-ss` 位置决定滤镜时间坐标系

当 `-af` 滤镜和 `-ss` 一起使用时，`-ss` 的位置至关重要：

```bash
# ❌ 错误：-ss 在 -i 之后（输出选项）
# 滤镜处理整个文件时间线，afade 在全局时间 6.93s 执行淡出
# 但提取的片段从 10s 开始 → 到达时音量已经是 0 → 完全静音！
ffmpeg -v quiet -i source.wav -ss 10 -to 17 \
  -af "afade=t=in:d=0.3,afade=t=out:st=6.93:d=0.3" -y output.wav

# ✅ 正确：-ss 在 -i 之前（输入选项），用 -t（时长）替代 -to（绝对时间）
# 滤镜从时间 0 开始处理，afade 时间参数和片段本身对齐
ffmpeg -v quiet -ss 10 -i source.wav -t 7 \
  -af "afade=t=in:d=0.3,afade=t=out:st=6.7:d=0.3" -y output.wav
```

**真实 bug**：`cut_audio.py` 把 `-ss`/`-to` 放在 `-i` 之后，导致除第一个片段（start=0）外所有片段的淡出在片段开始前已完成，输出 55 分钟静音。只有第一个片段（0-9.12s）正常。

### 陷阱 11: cut_audio.py 必须用 WAV 中间格式（原陷阱 10）

MP3 `-c copy` 切割只有帧级精度（~26ms），会导致保留词首字被吃（如"对"）或删除词尾音泄漏（如"放"）。

**修复**（v2）：先解码为 WAV → 从 WAV 切割（采样级精确）→ 合并后编码回 MP3。临时 WAV 约 647MB（2小时播客），剪完自动清理。

### 陷阱 12: 导出范围终点必须 seekTarget 对齐

HTML 播放器跳过删除段后落在 `nextKept.startTime`。导出函数必须做同样的对齐（snap range end 到下一个保留句起点），否则 ffmpeg 切点和 HTML 听感不一致。

### 陷阱 13: 审查稿手动编辑的文本匹配必须用 charOffset

**问题 1**：用户在句中选中"你"做手动删除，但 `indexOf("你")` 匹配到了句中已被精剪标记的第一个"你"（位置不同），导致标记错位。

**问题 2**：用户选中整句做删除时，`sel.toString()` 包含了 UI 标签（`.fine-tag`、`.manual-tag`）的文本内容（如 `">stutter"`），导致文本匹配失败。

**正确做法**：
1. `markSelectionDeletedAndPrompt()` 用 `range.cloneContents()` 克隆后**移除所有 UI 标签元素**，再取 `textContent`
2. 同时计算 `charOffset`（选区在纯文本中的字符偏移位置），存入手动编辑对象
3. `rebuildRowWithManualEdits()` 匹配时优先用 `charOffset` 精确定位，`indexOf` 作为 fallback

```javascript
// 计算 charOffset
const preRange = document.createRange();
preRange.setStart(textEl, 0);
preRange.setEnd(range.startContainer, range.startOffset);
const preFrag = preRange.cloneContents();
preFrag.querySelectorAll('.fine-tag, .manual-tag, ...').forEach(el => el.remove());
const charOffset = (preFrag.textContent || '').length;
```

### 陷阱 14: 审查稿不能用正则处理 innerHTML

**问题**：missed-catch 补丁用正则在 `innerHTML` 上匹配文本，命中了 HTML 属性值（如 `title="stutter"` 中的文本），导致页面出现乱码（`">stutter`）。

**正确做法**：所有文本操作统一用 DOM API（`querySelectorAll`、`insertBefore`、`createElement`），禁止在 `innerHTML` 上做正则替换。

### 陷阱 15: UI 装饰标签不能挡住文本选择

**问题**：`.manual-tag`（显示"手动"徽章）遮挡了下方文字的鼠标事件，导致单字"你"无法被选中划线。

**修复**：给所有装饰标签加 `pointer-events: none`：
```css
.manual-tag, .fine-tag, .missed-catch-tag { pointer-events: none; }
```

### 陷阱 16: 浏览器预览卡顿 ≠ 最终成品问题

**现象**：审查页 cut-mode 播放时，0ms gap 连读词（如"这个球"→"所以"、"但其实困住我们的"）的删除边界有明显卡顿/爆破。

**原因**：浏览器 `<audio>` seek 精度 ≈ 26ms（MP3 帧边界），加上解码器 settling time，0ms gap 的连读词无法干净切割。

**结论**：这是浏览器物理限制，**不影响最终成品**。`cut_audio.py` 解码为 WAV 后在 PCM 样本级操作（精度 ≈ 0.02ms @44100Hz），加上自适应 crossfade，即使紧密连读词也能干净切割。用户实际试听确认无爆破。

**不需要的方案**：
- ❌ 推荐用户不删紧密连读词 — FFmpeg 成品没问题，不需要限制用户
- ❌ AI 声音克隆重新生成 — 过度工程化，FFmpeg crossfade 已足够

### 陷阱 17: 步骤 8 必须用 cut_audio.py，不要手写 FFmpeg

**问题**：曾手写 `generate_cut.js`（filter_complex + 188 atrim），导致 FFmpeg 处理极慢（每段都从头解码整个文件）。

**正确做法**：直接调用 `cut_audio.py`，它已解决所有已知问题：
- WAV 中间格式（采样级精确）
- `-ss` 在 `-i` 前面（陷阱 10）
- 自适应 fade（陷阱 11）
- 说话人音量补偿
- concat demuxer 拼接（快速）

**不要重新发明轮子**。即使觉得脚本不适用，也应先读 `cut_audio.py` 源码确认，而不是手写替代方案。

### 陷阱 18: 精剪 stutter 取消后，其他编辑被阻断

**现象**：用户取消了某个 stutter 标记（如 411 句的数字误判），但该句上的其他手动编辑（如删除其他词）无法操作。

**可能原因**：`toggleFineEdit()` 改变了 `fineEditsDisabled` 状态后，`rebuildRowText()` 重建 HTML 时，覆盖了手动编辑的渲染（`rebuildRowWithManualEdits` 未被调用）。需要确认 `rebuildRowText` 和 `rebuildRowWithManualEdits` 的调用链是否正确联动。

**待修复**。

### 陷阱 19: stutter 取消后仍显示删除线

**现象**：956 句取消 stutter 后，文本仍有删除标记。974 句 "100万" 中间的数字部分被删了一块。

**可能原因**：同一句有多个精剪编辑（stutter + silence 或其他），取消其中一个 stutter 不影响其他编辑的渲染。用户可能误以为取消 stutter 会取消所有精剪。也可能是数字拆词导致的精剪误标（见陷阱 18 的数字豁免规则）。

**待修复**。

### 陷阱 20: 剪辑成品中出现原文没有的残句

**现象**：951 句听起来是残句，但原始音频里该位置没有问题。可能是 cut_audio.py 拼接时的切点不精确导致的。

**排查方向**：检查 951 句对应的 keep_segment 边界时间，对比 subtitles_words.json 中的词边界，确认是否有 timing 偏移。

**待修复**。

### 陷阱 21: 审查稿未标删但成品中被吞掉

**现象**：1066 句提到 "985" 时，成品中该数字被吞掉，但审查稿上没有标注删除。

**可能原因**：精剪脚本将数字相关词误标为 stutter（见卡顿词规则中的数字豁免），导致 `delete_segments.json` 中包含了该段的删除，但审查稿的渲染可能有遗漏。也可能是 `merge_fine_edits.js` 合并时边界扩展导致相邻内容被吞。

**待修复**。

### 陷阱 24: 静音裁剪保留量必须低于检测阈值

**问题**：silencedetect 阈值 0.8s，裁剪时保留 0.4+0.4=0.8s，结果仍有 300 个 0.80-0.85s 的静音被报告。

**原因**：silencedetect 的 "silence boundary" 和裁切点不是同一位置。silencedetect 看的是能量低于 noise dB 的连续区域，但裁切点是按时间戳硬切的，边缘处的低能量音频（如呼吸尾音）会被 silencedetect 算入静音区间。

**正确做法**：保留量 = 目标阈值 - 0.2s 的 buffer。如目标 0.8s，保留 0.3+0.3=0.6s。`trim_silences.py` 默认 `--target 0.6` 已内置此 buffer。

### 陷阱 25: 句中删词后的间隙感知阈值远低于句间

**问题**：s49 删了 "他也"（卡顿重复），删除范围仅覆盖词本身 `[279.94, 280.78]`，前后词的间隙（279.82→281.46 = 1.64s）产生了明显的不自然停顿。

**原因**：
1. 句间 0.8s 停顿是自然的（换气/消化），但句中 0.3s 以上的间隙就被感知为"卡了"
2. ASR 时间戳有间隙：被删词的 start 晚于实际发声，end 早于下一词

**正确做法**：删除句中内容时，范围必须扩展到 `[prev_word.end, next_word.start]`，不留间隙。适用于 stutter、self_correction、句内 filler 等所有句中删除类型。

### 陷阱 26: 填充词删除范围必须覆盖 onset 泄露

**问题**：s9 末尾的 "嗯" 已标记删除 `[21.13, 21.73]`，但成品中仍有残音。

**原因**：ASR 报告 filler.start (21.13) 比实际发声晚。前一词 "岁" 结束在 20.53，中间 0.6s 间隙包含 "嗯" 的起始音。

**正确做法**：填充词删除范围 = `[prev_word.end, next_word.start]`，而非 `[filler.start, filler.end]`。详见 `用户习惯/2-填充词检测.md` 删除边界章节。

### 陷阱 22: 句首停顿标记显示在错误位置

**现象**：静音间隙在 fine_analysis 中被分配给上一句（包含 gap 前最后一个词的句子），但用户听到停顿时看的是下一句开头 → 用户认为"没有识别出来"。

**数据**：12 个用户标注的句首停顿中，9 个实际已被检测但显示在上一句末尾，3 个实际 gap < 0.8s（用户感知偏差）。

**修复**：`generate_review_enhanced.js` 增加 `incomingSilences` 字段，将 silence 编辑同时传给下一个非删除句。`review_enhanced.html` 模板在句首渲染 `⏸ -Xs` 标记（黄色虚线边框，可点击联动 toggleFineEdit）。**已修复**。

### 陷阱 23: merge_fine_edits.js 静音编辑未进入 delete_segments（三重 bug）

**现象**：fine_analysis.json 检测到 113 个 silence 编辑，但 merge_fine_edits.js 转换为 delete_segments 时几乎全部丢失 → 最终成品未删除停顿。

**三重 bug**：
1. **句内搜索**：silence gap 在句子边界外（前一句末尾→下一句开头），但脚本在句内词之间找间隙 → 找不到
2. **actualWords 过滤了 isGap**：`words` 数组不含 gap 元素，词间距只有自然间隙（~0.1s），不是真正的停顿
3. **阈值错误**：硬编码 `> 1.0s` 而非 `> 0.8s`

**根本原因**：`fine_analysis.json` 已有精确的 `deleteStart`/`deleteEnd`，但 merge 脚本没有使用，而是试图重新计算。

**修复**：直接使用 `edit.deleteStart`/`edit.deleteEnd`，保留 0.8s 自然停顿后删除超出部分。**已修复**。

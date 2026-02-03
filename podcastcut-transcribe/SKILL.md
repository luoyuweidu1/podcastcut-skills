---
name: podcastcut-transcribe
description: 口播视频转录和口误识别。生成审查稿和删除任务清单。触发词：剪口播、处理视频、识别口误、transcribe video
---

<!--
input: 粗剪后的音频 (v2.mp3) + 原内容审查稿
output: 统一审查稿、删除清单
pos: 转录+识别，到用户审核为止
-->

# 口误识别

> 在粗剪基础上，识别口误/重复/原审查稿未处理的删除 → 生成统一审查稿

## 快速使用

```
用户: 识别口误 /path/to/v2.mp3
用户: 精剪准备
```

## 前置条件

需要先完成粗剪：
1. `/podcastcut-content` → 生成 `podcast_审查稿.md`
2. `/podcastcut-edit-raw` → 输出 v2 音频

## 流程

```
1. 加载原内容审查稿，提取未处理的删除标记
    ↓
2. FunASR 30s 分段转录（字符级时间戳）
    ↓
3. 检测静音（FFmpeg silencedetect，≥2s）
    ↓
4. 检测语气词（嗯/哎/诶，前后有停顿的）
    ↓
5. 检测叠词（连续重复字，如"会会"）
    ↓
6. 检测短语重复（N-gram，如"和大家都很关心的很和大家都很关心的"）
    ↓
7. 生成统一审查稿（合并所有来源）
    ↓
【等待用户确认】→ 用户确认后，执行 /podcastcut-edit-fine
```

---

## 一、扫描原审查稿

**关键**：粗剪只能整句删，半句删除标记会被跳过。必须在精剪时处理。

```python
def extract_unprocessed_deletions(original_review_path, chars):
    """从原审查稿提取未处理的半句删除"""
    deletions = []

    with open(original_review_path, 'r') as f:
        content = f.read()

    # 解析 ~~删除标记~~
    pattern = r'~~([^~]+)~~'
    for match in re.finditer(pattern, content):
        deleted_text = match.group(1)
        # 检查是否是半句（不是完整句子）
        # 用字符级时间戳定位
        time_range = find_text_in_chars(deleted_text, chars)
        if time_range:
            deletions.append({
                'start': time_range[0],
                'end': time_range[1],
                'text': deleted_text,
                'type': 'original_review'
            })

    return deletions
```

---

## 二、检测短语重复（新增）

**问题**：叠词检测只能发现 "会会"，无法发现 "和大家都很关心的很和大家都很关心的"。

**解决**：N-gram 滑动窗口检测。

```python
def detect_phrase_repetitions(text, chars, min_len=4, max_len=12):
    """检测短语级重复"""
    repetitions = []

    for phrase_len in range(min_len, max_len + 1):
        i = 0
        while i < len(text) - phrase_len:
            phrase = text[i:i + phrase_len]

            # 跳过纯标点/空格
            if not any(c.isalnum() or '\u4e00' <= c <= '\u9fff' for c in phrase):
                i += 1
                continue

            # 在后续文本中查找重复（允许中间有几个字的间隔）
            search_start = i + phrase_len
            search_end = min(i + phrase_len * 2 + 5, len(text))
            rest = text[search_start:search_end]

            if phrase in rest:
                repeat_pos = rest.find(phrase)
                # 找到重复，计算时间戳
                first_start_idx = i
                first_end_idx = i + phrase_len - 1

                repetitions.append({
                    'phrase': phrase,
                    'first_start': chars[first_start_idx]['start'],
                    'first_end': chars[first_end_idx + repeat_pos + phrase_len]['end'],
                    'type': 'phrase_repeat',
                    'action': 'delete_first'  # 保留第二个
                })

                # 跳过已处理的部分
                i = search_start + repeat_pos + phrase_len
            else:
                i += 1

    return merge_overlapping(repetitions)
```

### 重复处理规则

| 场景 | 处理 | 示例 |
|------|------|------|
| 短语重复 | **保留第二个** | "和大家都很关心的很**和大家都很关心的**经常..." |
| 叠词口误 | 删第一个 | "会~~会~~" → "会" |
| 合法叠词 | 不删 | "哥哥"、"慢慢"、"天天" |

---

## 三、统一审查稿格式

输出一个合并所有来源的审查稿：

```markdown
# 精剪审查稿

**输入**: v2.mp3 (粗剪后)
**时长**: 1:28:00

---

## 删除清单

### 原审查稿未处理 (N处)
粗剪跳过的半句删除：

- [ ] `(46.13-49.03)` ~~嗯我可以讲一下对~~ [原审查稿]

### 短语重复 (N处)
保留第二个，删除第一个：

- [ ] `(35.31-37.77)` ~~和大家都很关心的很~~ → 保留"和大家都很关心的经常..."

### 静音 (N处)
≥2s 的静音片段：

- [ ] `(120.50-123.80)` 静音 3.3s

### 语气词 (N处)
前后有停顿的独立语气词：

- [ ] `(45.20-45.85)` ~~嗯~~ 上下文: ...说的【嗯】然后...

### 叠词/口误 (N处)

- [ ] `(88.30-88.55)` ~~会~~会 (删第一个)

---

## 统计

| 类型 | 数量 | 时长 |
|------|------|------|
| 原审查稿未处理 | 1 | 2.9s |
| 短语重复 | 1 | 2.5s |
| 静音 | 15 | 45.0s |
| 语气词 | 42 | 25.0s |
| 叠词/口误 | 23 | 8.0s |
| **合计** | 82 | 83.4s |
```

---

## 四、输出文件

```
<工作目录>/
├── transcript_chars.json   # 字符级时间戳
├── silences.json           # 静音检测结果
├── fillers.json            # 语气词检测结果
├── repetitions.json        # 叠词检测结果
├── phrase_repeats.json     # 短语重复检测结果（新增）
├── 审查稿.md               # 统一审查稿
└── deletions.json          # 删除清单（供 edit-fine 使用）
```

---

## 五、合法叠词（不删）

```python
VALID_REDUPLICATIONS = [
    # 亲属称呼
    '哥哥', '姐姐', '妹妹', '弟弟', '爸爸', '妈妈', '爷爷', '奶奶',
    # 人名
    '安安', '麦雅',
    # 语气词叠用
    '嗯嗯', '哦哦', '啊啊',
    # 副词叠用
    '常常', '满满', '整整', '刚刚', '慢慢', '渐渐', '稍稍', '偷偷',
    '默默', '悄悄', '静静', '轻轻', '重重', '深深', '浅浅',
    '多多', '少少', '大大', '小小', '高高', '低低',
    '好好', '坏坏', '快快', '乐乐', '开开', '心心',
    '天天', '年年', '月月', '日日', '夜夜',
    '点点', '滴滴', '片片', '层层', '步步', '节节',
]
```

---

## 六、可复用脚本

脚本位置：`scripts/` 目录

### 6.1 transcribe_chars.py

FunASR 30s 分段转录，生成字符级时间戳。

```bash
python scripts/transcribe_chars.py <音频文件> <输出目录>
```

**输出**: `transcript_chars.json`

### 6.2 detect_phrase_repeats.py ⭐ 新增

检测短语级重复（N-gram 滑动窗口）。

```bash
python scripts/detect_phrase_repeats.py <工作目录>
```

**输入**: `transcript_chars.json`
**输出**: `phrase_repeats.json`

**使用时机**: 转录完成后，检测如 "和大家都很关心的很和大家都很关心的" 这类短语重复。

### 6.3 extract_original_deletions.py ⭐ 新增

从原审查稿提取未处理的删除标记。

```bash
python scripts/extract_original_deletions.py <工作目录> <原审查稿路径>
```

**输入**: `transcript_chars.json` + 原审查稿（含 `~~删除线~~`）
**输出**: `original_deletions.json`

**使用时机**: 粗剪后，原审查稿中有半句删除标记未被处理时使用。

### 完整流程示例

```bash
WORK_DIR="/path/to/project"
AUDIO="/path/to/v2.mp3"
ORIGINAL_REVIEW="/path/to/podcast_审查稿.md"

# 1. 转录（如果还没有 transcript_chars.json）
python scripts/transcribe_chars.py "$AUDIO" "$WORK_DIR"

# 2. 检测短语重复
python scripts/detect_phrase_repeats.py "$WORK_DIR"

# 3. 提取原审查稿删除标记
python scripts/extract_original_deletions.py "$WORK_DIR" "$ORIGINAL_REVIEW"

# 4. 生成统一审查稿（由 AI 合并各检测结果）
```

---

## 七、方法论

详见 `tips/口误识别方法论.md`：
- FunASR 30s 分段避免时间戳漂移
- 逐 token 分析口误边界
- "删前面保后面" 的精确处理

---

## 反馈记录

### 2026-02-01
- **新增短语级重复检测**
  - 问题：叠词检测只能发现 "会会"，无法发现短语重复
  - 案例：`和大家都很关心的很和大家都很关心的经常发生的 burn out`
  - 解决：N-gram 滑动窗口检测，识别 4-12 字的短语重复

- **新增扫描原审查稿**
  - 问题：粗剪只能整句删，半句删除标记被跳过
  - 案例：原审查稿标记 `~~嗯，我可以讲一下对~~`
  - 解决：transcribe 时扫描原审查稿，提取未处理的删除标记

- **统一审查稿输出**
  - 合并所有来源：原审查稿未处理 + 静音 + 语气词 + 叠词 + 短语重复
  - edit-fine 只需读取这一个文件

- **重复处理规则：保留第二个**
  - 用户反馈：重复时第二个通常是说话人想要的正确版本
  - 规则：短语重复时删除第一个，保留第二个

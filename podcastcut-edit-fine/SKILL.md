---
name: podcastcut-edit-fine
description: 精剪播客。根据统一审查稿执行字符级FFmpeg剪辑，默认快速模式。触发词：精剪、执行精剪、fine cut
---

<!--
input: 统一审查稿（来自 /podcastcut-transcribe）+ 粗剪音频
output: 精剪后音频
pos: 执行剪辑
-->

# 精剪

> 读取统一审查稿 → 过滤/合并 → 快速执行 FFmpeg

## 快速使用

```
用户: 精剪
用户: 执行精剪
用户: 按审查稿精剪
```

## 前置条件

需要先执行 `/podcastcut-transcribe` 生成统一审查稿。

## 流程

```
1. 读取统一审查稿（来自 transcribe）
    ↓
2. 过滤微小删除（< 0.3s）
    ↓
3. 合并相邻删除（gap < 1.0s）
    ↓
4. 计算保留片段
    ↓
5. 生成 FFmpeg filter → 执行剪辑
    ↓
6. 输出 v3 音频
```

---

## 一、快速模式（默认）

**目标**：减少 FFmpeg 分段数，加速处理。

### 优化参数

```python
# 快速模式参数
MIN_DELETE_DURATION = 0.3   # 忽略 < 0.3s 的删除（听不出来）
MIN_SILENCE_DURATION = 2.0  # 静音阈值（原 1.5s）
MERGE_GAP_THRESHOLD = 1.0   # 合并阈值（原 0.3s）
```

### 效果对比

| 模式 | 分段数 | 处理时间 | FFmpeg 速度 |
|------|--------|----------|-------------|
| 原版 | 570 | 38 分钟 | 2.5x |
| 快速 | 154 | 3.5 分钟 | 32x |

**加速 ~11 倍**，代价是保留了一些微小的静音/语气词（总计约 2-3 分钟），听感影响很小。

---

## 二、删除清单处理

### 输入

只读取 `/podcastcut-transcribe` 输出的统一审查稿：

```
<工作目录>/
├── 审查稿.md          # 统一审查稿（包含所有删除标记）
├── deletions.json     # 删除清单
└── transcript_chars.json  # 字符级时间戳
```

**不需要扫描多个审查稿**：transcribe 已经合并了所有来源。

### 过滤逻辑

```python
def filter_deletions(deletions):
    """过滤微小删除"""
    return [
        d for d in deletions
        if d['end'] - d['start'] >= MIN_DELETE_DURATION
    ]
```

### 合并逻辑

```python
def merge_deletions(deletions, gap_threshold=MERGE_GAP_THRESHOLD):
    """合并相邻的删除"""
    if not deletions:
        return []

    sorted_dels = sorted(deletions, key=lambda x: x['start'])
    merged = []
    current = {'start': sorted_dels[0]['start'], 'end': sorted_dels[0]['end']}

    for d in sorted_dels[1:]:
        if d['start'] <= current['end'] + gap_threshold:
            current['end'] = max(current['end'], d['end'])
        else:
            merged.append(current)
            current = {'start': d['start'], 'end': d['end']}

    merged.append(current)
    return merged
```

---

## 三、FFmpeg 命令

### 纯音频（mp3）

```bash
ffmpeg -y -i input.mp3 \
  -filter_complex_script filter.txt \
  -map "[outa]" \
  -c:a libmp3lame -q:a 2 \
  output_v3.mp3
```

### filter.txt 格式

```
[0:a]atrim=start=0.000:end=35.310,asetpts=PTS-STARTPTS[a0];
[0:a]atrim=start=37.769:end=46.129,asetpts=PTS-STARTPTS[a1];
[0:a]atrim=start=49.029:end=120.500,asetpts=PTS-STARTPTS[a2];
...
[a0][a1][a2]...concat=n=N:v=0:a=1[outa]
```

---

## 四、边界处理

### 过渡时间

删除时保留微小过渡，避免卡顿：

| 删除类型 | 过渡规则 |
|----------|----------|
| 语气词 | 前后各 0.05s |
| 静音 | 保留 0.15s |
| 口误 | 无需过渡 |

### 边界精度

相邻片段边界要小心避免重叠：

```python
# "对" 结束于 49.030，"这" 开始于 49.030
# 删除结束设为 49.029，避免重叠
deletion_end = 49.029  # 不是 49.030
```

---

## 五、输出文件

```
<工作目录>/
├── 原始音频_v3.mp3      # 精剪后音频
├── 删除清单_v3.json      # 合并后的删除清单
├── keep_segments_v3.json # 保留片段列表
├── filter_v3.txt         # FFmpeg filter 脚本
└── ffmpeg_cmd_v3.sh      # FFmpeg 完整命令
```

---

## 六、可复用脚本 ⭐

脚本位置：`scripts/` 目录

### 6.1 merge_deletions_fast.py

**一键快速模式**：过滤 + 合并 + 生成 FFmpeg 命令。

```bash
python scripts/merge_deletions_fast.py <工作目录> [输入文件] [输出文件]
```

**输入**: `deletions_unified.json` 或 `deletions.json`

**输出**:
- `deletions_fast.json` - 合并后的删除清单
- `keep_segments_fast.json` - 保留片段
- `filter_fast.txt` - FFmpeg filter 脚本
- `ffmpeg_cmd_fast.sh` - 执行命令

**使用时机**: 精剪时**必须使用此脚本**，否则分段过多导致 FFmpeg 极慢。

### 完整流程示例

```bash
WORK_DIR="/path/to/project"
INPUT="/path/to/v2.mp3"
OUTPUT="/path/to/v3.mp3"

# 1. 快速模式合并 + 生成 FFmpeg 命令
python scripts/merge_deletions_fast.py "$WORK_DIR" "$INPUT" "$OUTPUT"

# 2. 执行剪辑
bash "$WORK_DIR/ffmpeg_cmd_fast.sh"
```

### 为什么必须用这个脚本？

| 方式 | 分段数 | FFmpeg 时间 |
|------|--------|-------------|
| 不合并 | 570+ | 38 分钟 |
| **用脚本** | 150 | 3.5 分钟 |

**加速 11 倍**，代价是保留微小静音（听感影响很小）。

---

## 七、使用示例

```
用户: 精剪

AI: 好的，读取统一审查稿...
    - 删除项: 168 处
    - 过滤微小删除后: 82 处
    - 合并后: 45 个删除块
    - 保留: 46 段

    执行 FFmpeg...
    - 处理时间: 3 分 26 秒
    - 速度: 32x

    结果:
    - 原始时长: 1:28:00
    - 精剪后: 1:26:30
    - 删除: 1:30

    输出: 原始音频_v3.mp3
```

---

## 反馈记录

### 2026-02-01
- **快速模式作为默认**
  - 问题：570 分段导致 FFmpeg 处理需要 38 分钟
  - 解决：提高合并阈值 + 过滤微小删除，减少到 154 分段
  - 效果：处理时间从 38 分钟降到 3.5 分钟，加速 11 倍

- **简化输入：只读取统一审查稿**
  - 问题：之前需要扫描多个审查稿，容易遗漏
  - 解决：transcribe 输出统一审查稿，edit-fine 只读这一个
  - 好处：逻辑简单，不会漏删

- **边界精度问题**
  - 问题："这期嘉宾其实" 被误删
  - 原因：删除结束时间和下一段开始时间重叠（都是 49.030）
  - 解决：`merge_deletions_fast.py` 中删除结束时间减 0.001s
  - 代码：`d['end'] = round(d['end'] - 0.001, 3)`

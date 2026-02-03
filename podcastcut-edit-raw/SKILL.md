---
name: podcastcut-edit-raw
description: 粗剪播客。根据审查稿删除标记执行句子级FFmpeg剪辑。触发词：粗剪、句子级剪辑、rough cut
---

# 粗剪

> 遍历 transcript 每个句子 → 检查是否在删除标记中 → 整句删除

## 快速使用

```
用户: 按这个审查稿粗剪 /path/to/podcast_审查稿.md
用户: 粗剪，输出到 /path/to/output
```

## 适用场景

| 场景 | 说明 |
|------|------|
| ✅ 删大段内容 | 寒暄、跑题、隐私、啰嗦 |
| ✅ 删整句 | 句子级时间戳足够精确 |
| ❌ 删半句/口误 | 用 `/podcastcut-edit-fine` 或 `/podcastcut-transcribe` |

---

## 核心逻辑

```python
# 从 transcript 出发，检查每个句子是否需要删除
for sentence in transcript['sentences']:
    if normalize(sentence['text']) in 审查稿删除标记:
        删除这个句子
```

**为什么从 transcript 出发？**
- transcript.json 的每个句子都有精确时间戳
- 只需检查句子文本是否在 `~~删除标记~~` 中
- 不需要复杂的多句组合匹配
- 100% 利用已有的句子边界

---

## 流程

```
1. 加载审查稿，提取所有 ~~删除标记~~
    ↓
2. 加载 transcript.json（句子级时间戳）
    ↓
3. 遍历每个句子，检查是否在删除标记中
    ↓
4. 合并连续删除 → 计算保留片段
    ↓
5. 生成 FFmpeg filter → 执行剪辑
    ↓
6. 输出 podcast_v2.mp3/mp4
```

---

## 匹配逻辑

```python
def is_sentence_deleted(sentence_text, deletions):
    """检查句子是否应该删除"""
    text_norm = normalize(sentence_text)  # 移除空格标点

    # 句子出现在任一删除标记中 → 删除
    for deletion in deletions:
        if text_norm in normalize(deletion):
            return True

    return False
```

**标准化**：移除空格、标点后比较，避免格式差异导致不匹配。

---

## 可复用脚本

### rough_cut.py

一键完成粗剪全流程。

```bash
python scripts/rough_cut.py <工作目录> <输入音频> [输出音频]
```

**示例**：
```bash
python scripts/rough_cut.py \
  "/Volumes/T9/podcast/v5" \
  "/Volumes/T9/podcast/原始音频.mp3"
```

**输入**：
- `podcast_审查稿.md` - 带删除标记的审查稿
- `podcast_transcript.json` - 句子级时间戳

**输出**：
- `podcast_删除清单.json` - 删除的句子列表
- `keep_segments.json` - 保留片段列表
- `filter.txt` - FFmpeg filter 脚本
- `ffmpeg_cmd.sh` - FFmpeg 完整命令

---

## 输出文件

```
<工作目录>/
├── podcast_v2.mp3           # 剪辑后音频
├── podcast_删除清单.json     # 删除时间段列表
├── keep_segments.json       # 保留片段列表
├── filter.txt               # FFmpeg filter 脚本
└── ffmpeg_cmd.sh            # FFmpeg 完整命令
```

---

## FFmpeg 命令

### 纯音频（mp3）

```bash
ffmpeg -y -i input.mp3 \
  -filter_complex_script filter.txt \
  -map "[outa]" \
  -c:a libmp3lame -q:a 2 \
  output_v2.mp3
```

### 音视频（mp4）

```bash
ffmpeg -y -i input.mp4 \
  -filter_complex_script filter.txt \
  -map "[outv]" -map "[outa]" \
  -c:v libx264 -crf 18 -c:a aac \
  output_v2.mp4
```

---

## 使用示例

```
用户: 按审查稿粗剪 /path/to/podcast_审查稿.md

AI: 好的，开始粗剪...
    1. 加载审查稿: 144 处删除标记
    2. 加载 transcript: 3376 句
    3. 匹配删除: 296 个句子
    4. 合并后: 137 个删除块
    5. 生成 FFmpeg 命令并执行

    结果:
    - 原始时长: 2:08:07
    - 剪辑后: 1:57:54
    - 删除: 10:13
```

---

## 与精剪的区别

| 对比 | 粗剪 (本 Skill) | 精剪 (/podcastcut-edit-fine) |
|------|-----------------|------------------------------|
| 时间戳 | 句子级 | 字符级 |
| 最小单位 | 整句 | 单字 |
| 适用 | 删大段内容 | 删口误、语气词 |
| 输入 | podcast_transcript.json | podcast_transcript_chars.json |

---

## 反馈记录

### 2026-02-01
- **单字符句子匹配问题**
  - 问题："好，" 标准化后变成 "好"（1字符），被 `len < 2` 跳过，导致没删掉
  - 修复：单字符用精确匹配，多字符用包含匹配
  ```python
  if len(text_norm) == 1:
      text_norm == del_norm  # 精确匹配，避免误删
  else:
      text_norm in del_norm  # 包含即可
  ```
  - 原因：单字符如果用包含匹配，"好" 会匹配任何含 "好" 的删除标记，造成误删

### 2026-01-31
- **改用"从 transcript 出发"的匹配逻辑**
  - 原来：解析审查稿删除标记 → 尝试匹配 transcript 句子（容易失败）
  - 现在：遍历 transcript 句子 → 检查是否在删除标记中（简单可靠）
  - 原因：审查稿删除标记可能跨多句，反向匹配更简单

### 2026-01-31 (早)
- **创建独立 Skill**：从 `/podcastcut-edit` 拆分出来
- 粗剪聚焦句子级删除，精剪由 `/podcastcut-edit-fine` 处理

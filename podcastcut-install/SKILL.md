---
name: podcastcut-install
description: 环境准备。安装依赖、下载模型、验证环境。触发词：安装、环境准备、初始化、install videocut
---

<!--
input: 无
output: 环境就绪
pos: 前置 skill，首次使用前运行
-->

# 安装

> 首次使用前的环境准备

## 快速使用

```
用户: 安装环境
用户: 初始化
用户: 下载模型
```

## 依赖清单

| 依赖 | 用途 | 安装命令 |
|------|------|----------|
| funasr | 转录 + 口误识别 | `pip install funasr` |
| modelscope | 模型下载 | `pip install modelscope` |
| ffmpeg | 视频剪辑 | `brew install ffmpeg` |

## 模型清单

### FunASR 模型

首次运行自动下载到 `~/.cache/modelscope/`：

| 模型 | 大小 | 用途 |
|------|------|------|
| paraformer-zh | 953MB | 语音识别（字符级时间戳） |
| punc_ct | 1.1GB | 标点预测（句子分割） |
| fsmn-vad | 4MB | 语音活动检测 |
| cam++ | ~100MB | 说话人分离 |
| **总计** | **~2.1GB** | |

### 为什么统一用 FunASR？

| 阶段 | 功能 | 说明 |
|------|------|------|
| content（内容剪辑） | 转录 + 说话人分离 + 句子时间戳 | 一次调用 |
| transcribe（口误识别） | 转录 + 字符级时间戳 | 30s 分段 |
| subtitle（字幕生成） | 直接用转录结果 | |

- 中文识别准确率高（阿里优化）
- 内置说话人分离（cam++）
- 支持句子级和字符级时间戳
- 一套工具解决所有阶段

## 安装流程

```
1. 安装 Python 依赖
       ↓
2. 安装 FFmpeg
       ↓
3. 下载 FunASR 模型
       ↓
4. 验证环境
```

## 执行步骤

### 1. 安装 Python 依赖

```bash
pip install funasr modelscope
```

### 2. 安装 FFmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu
sudo apt install ffmpeg

# 验证
ffmpeg -version
```

### 3. 下载 FunASR 模型（约2.1GB）

```python
from funasr import AutoModel

# 下载全部模型（含说话人分离）
model = AutoModel(
    model="paraformer-zh",
    vad_model="fsmn-vad",
    punc_model="ct-punc",
    spk_model="cam++",  # 说话人分离
)
print("FunASR 模型下载完成")
```

### 4. 验证环境

```python
from funasr import AutoModel

model = AutoModel(
    model="paraformer-zh",
    vad_model="fsmn-vad",
    punc_model="ct-punc",
    spk_model="cam++",
    disable_update=True
)

# 测试转录（用任意音频/视频）
result = model.generate(input="test.mp4", sentence_timestamp=True)
print("文本:", result[0]['text'][:50])
if 'sentence_info' in result[0]:
    print("句子数:", len(result[0]['sentence_info']))
    # 检查说话人分离
    spk_ids = set(s.get('spk', 0) for s in result[0]['sentence_info'])
    print("说话人数:", len(spk_ids))
print("✅ 环境就绪")
```

## 常见问题

### Q1: 模型下载慢

**解决**：使用国内镜像或手动下载

### Q2: ffmpeg 命令找不到

**解决**：确认已安装并添加到 PATH

```bash
which ffmpeg  # 应该输出路径
```

### Q3: funasr 导入报错

**解决**：检查 Python 版本（需要 3.8+）

```bash
python3 --version
```

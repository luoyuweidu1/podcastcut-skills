---
name: podcastcut:执行
description: |
  播客剪辑执行单元（pipeline 执行步）：按 delete_segments 从原始音频切出精剪成品，再做成品静音裁剪。
  基于 audio_original.* + cut_audio.py（采样级精确、≥192k、说话人音量对齐）+ trim_silences.py。
  触发词：执行剪辑、剪辑成品、生成成品、出片、cut、execute
---

<!--
input: delete_segments_edited.json（精剪导出）+ 1_转录/audio_original.* + subtitles_words.json
output: 3_成品/<名>_精剪版_vN.mp3 + *_trimmed.mp3、project.json(execute=done, products[])
pos: pipeline 执行步；上游=精剪(经 output/.current_project 交接)，下游=质检/音质处理/后期

架构守护者：cut_audio.py / trim_silences.py 暂在 剪播客/scripts/（被 安装/质检/后期 等共用）。
未来建 _shared/ 时统一迁移并更新所有引用。
-->

# 执行单元

> 把审查导出的删除清单 + 原始音频，切成精剪成品。pipeline 的"出片"步，独立可调用。

## 🔴 音质红线
- **必须用 `audio_original.*`** 剪辑，**禁止用 `audio.mp3`**（16k 降采样，成品会发闷）
- 成品 ≥192kbps
- 必须用 `cut_audio.py`，**不要手写 FFmpeg**（见剪播客陷阱 17）

## 输入契约
- `delete_segments_edited.json`（精剪导出；若只走了粗剪，则用 `delete_segments_roughcut.json`）
- `1_转录/audio_original.*`、`1_转录/subtitles_words.json`

## 脚本位置
`$SKILL_DIR/剪播客/scripts/`（cut_audio.py / trim_silences.py，与其它技能共用，未迁 `_shared/`）

---

## 步骤

### 0. 定位项目

```bash
PROJECT="${PROJECT:-$(cat "$SKILL_DIR/output/.current_project")}"
BASE_DIR="$SKILL_DIR/output/$PROJECT/剪播客"
AUDIO_NAME=$(node -e "console.log(require('$BASE_DIR/project.json').project.id.replace(/^\d{4}-\d{2}-\d{2}_/,''))")
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" execute in_progress
```

### 1. 一键剪辑（cut_audio.py）

```bash
cd "$BASE_DIR/2_分析"

# 删除清单：优先精剪导出，回退粗剪导出
DEL=delete_segments_edited.json
[ -f "$DEL" ] || DEL=delete_segments_roughcut.json

# 原始高质量音频（禁用 audio.mp3）
ORIGINAL_AUDIO=$(ls "$BASE_DIR/1_转录/audio_original."* 2>/dev/null | head -1)
[ -z "$ORIGINAL_AUDIO" ] && { echo "❌ 缺 audio_original.*，不能用 audio.mp3 出片"; exit 1; }

# 版本号：3_成品已有 vN 则自增（重剪历史）
N=1; while [ -f "$BASE_DIR/3_成品/${AUDIO_NAME}_精剪版_v${N}.mp3" ]; do N=$((N+1)); done
OUT="$BASE_DIR/3_成品/${AUDIO_NAME}_精剪版_v${N}.mp3"

python3 "$SKILL_DIR/剪播客/scripts/cut_audio.py" \
  "$OUT" "$ORIGINAL_AUDIO" "$DEL" \
  --speakers-json "$BASE_DIR/1_转录/subtitles_words.json" \
  --no-fade
```

> `--no-fade` **必须传**（默认 0.3s 自适应 fade 会吃短音节，见陷阱 27）。`--speakers-json` 始终传（说话人音量对齐，差异 <0.5dB 自动跳过）。

### 2. 成品静音裁剪（trim_silences.py）

```bash
python3 "$SKILL_DIR/剪播客/scripts/trim_silences.py" "$OUT"
# 默认检测 >0.8s 静音，裁到 0.6s；输出 *_trimmed.mp3
TRIMMED="${OUT%.mp3}_trimmed.mp3"
```
> 删内容后前后短静音会合并成超阈值长停顿，必须在成品上再扫一遍（见陷阱 24）。用户不满意可调 `--threshold/--target/--noise` 重跑。

### 3. 写状态清单

```bash
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" execute done \
  --outputs "{\"products\":[\"3_成品/$(basename "$OUT")\",\"3_成品/$(basename "$TRIMMED")\"]}" \
  --summary "{\"version\":$N,\"source\":\"$(basename "$ORIGINAL_AUDIO")\"}"
echo "✅ 成品: $TRIMMED"
```

> 重剪：回精剪改→重新导出→再调本单元，会自增 v$((N+1))，products 记历史版本。

---

## 输出契约
- `3_成品/<名>_精剪版_vN.mp3` + `*_trimmed.mp3`（≥192k）
- `project.json`：`execute.status=done`，`outputs.products[]` 记版本历史
- 下游：质检 / 音质处理 / 后期（按用户偏好触发）

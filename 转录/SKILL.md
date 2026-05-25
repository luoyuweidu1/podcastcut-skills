---
name: podcastcut:转录
description: |
  播客转录单元（pipeline 第一步）：准备音频 → 上传 → 阿里云 FunASR 转录 → 说话人映射 → 生成字级转录与分句。
  建项目目录 + project.json 状态清单，产出 subtitles_words.json / speaker_mapping.json / sentences.txt。
  触发词：转录、转录这个播客、生成字幕、transcribe
---

<!--
input: 音频文件 (*.mp3/*.wav/*.m4a/*.flac) + 说话人数量 + 姓名
output: 1_转录/subtitles_words.json、speaker_mapping.json、2_分析/sentences.txt、project.json(transcribe=done)
pos: pipeline 第一步；下游 = /podcastcut-粗剪（经 output/.current_project 交接）

架构守护者：脚本暂引用 剪播客/scripts/（与 质检 共用 aliyun_funasr_transcribe.sh、generate_subtitles_from_aliyun.js）。
未来建 _shared/ 时统一迁移并更新 剪播客/质检/转录 三处引用。
-->

# 转录单元

> 把一个音频文件变成可分析的转录数据。这是 pipeline 的"摄入"阶段，独立可调用。

## 必需输入
1. 音频文件路径
2. **说话人数量**（2人/3人…）—— **必须由用户提供，不可自行判断**（设错会大幅降低识别准确度）
3. 说话人姓名（用于映射 speaker_id）

> ⚠️ 用户未给说话人数量时**必须先问**。

## 脚本位置
转录脚本暂位于 `$SKILL_DIR/剪播客/scripts/`（与 质检 共用，尚未迁入 `_shared/`）。

---

## 步骤

### 1. 用户与项目设置

```bash
# 用户：环境变量优先；若无注册用户，先触发 onboarding（建用户档），见 用户偏好/
USER_ID="${PODCASTCUT_USER:-default}"

AUDIO_PATH="/path/to/播客.m4a"          # ← 用户提供
AUDIO_NAME=$(basename "$AUDIO_PATH" | sed 's/\.[^.]*$//')
DATE=$(date +%Y-%m-%d)
BASE_DIR="$SKILL_DIR/output/${DATE}_${AUDIO_NAME}/剪播客"
mkdir -p "$BASE_DIR/1_转录" "$BASE_DIR/2_分析" "$BASE_DIR/3_成品"

# 初始化/复用 project.json（幂等：已存在则不覆盖）
if [ ! -f "$BASE_DIR/project.json" ]; then
  node "$SKILL_DIR/剪播客/scripts/manifest.js" init "$BASE_DIR" --audio "$AUDIO_PATH" --user "$USER_ID" --title "$AUDIO_NAME"
fi
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" transcribe in_progress
```

### 2. 准备音频（三个版本，音质红线见剪播客）

```bash
AUDIO_EXT="${AUDIO_PATH##*.}"
cp "$AUDIO_PATH" "$BASE_DIR/1_转录/audio_original.$AUDIO_EXT"                      # 剪辑用，原始质量
ffmpeg -loglevel error -i "file:$AUDIO_PATH" -vn -acodec libmp3lame -ar 16000 -ac 1 -y "$BASE_DIR/1_转录/audio.mp3"          # ASR 用，16k mono
ffmpeg -loglevel error -i "file:$AUDIO_PATH" -c:a libmp3lame -b:a 192k -write_xing 1 -y "$BASE_DIR/1_转录/audio_seekable.mp3" # 审查页用，CBR 192k
```

### 3. 上传获取公网 URL

```bash
cd "$BASE_DIR/1_转录"
AUDIO_URL=$(curl -s -F "files[]=@audio.mp3" "https://uguu.se/upload?output=text")
echo "$AUDIO_URL" > audio_url.txt
echo "URL: $AUDIO_URL"   # 确认 HTTP 200 可公网访问；uguu.se 24h 有效
```

### 4. 阿里云 FunASR 转录

```bash
SPEAKER_COUNT=2   # ← 用户提供
cd "$BASE_DIR/1_转录"
bash "$SKILL_DIR/剪播客/scripts/aliyun_funasr_transcribe.sh" "$AUDIO_URL" "$SPEAKER_COUNT"
# 产出 aliyun_funasr_transcription.json（脚本已修复 0 字节下载 bug）
```

### 5. 识别说话人 + 创建映射

```bash
# 看前 20 句判断谁是谁（找自我介绍等线索）
node "$SKILL_DIR/剪播客/scripts/identify_speakers.js" "$BASE_DIR/1_转录/aliyun_funasr_transcription.json"
```
根据输出 + 用户给的姓名，写 `speaker_mapping.json`（speaker_id → 姓名）：
```bash
cat > "$BASE_DIR/1_转录/speaker_mapping.json" << 'EOF'
{ "0": "清扬", "1": "响歌歌" }
EOF
```

### 6. 生成字级转录 + 分句

```bash
cd "$BASE_DIR/1_转录"
node "$SKILL_DIR/剪播客/scripts/generate_subtitles_from_aliyun.js" aliyun_funasr_transcription.json speaker_mapping.json
# → subtitles_words.json（核心）

cd "$BASE_DIR/2_分析"
node "$SKILL_DIR/剪播客/scripts/generate_sentences.js" "$BASE_DIR/1_转录/subtitles_words.json"
# → sentences.txt（格式：句索引|词索引范围|说话人|文本）
```

### 7. 写状态清单（交接给下游）

```bash
# 说话人 + 句数/词数写入 manifest
SENT=$(wc -l < "$BASE_DIR/2_分析/sentences.txt" | tr -d ' ')
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-speakers "$BASE_DIR" --count "$SPEAKER_COUNT" --mapping "$(cat "$BASE_DIR/1_转录/speaker_mapping.json")" --verified
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" transcribe done \
  --summary "{\"sentences\":$SENT,\"asr\":\"aliyun_funasr\"}" \
  --outputs '{"subtitles":"1_转录/subtitles_words.json","sentences":"2_分析/sentences.txt"}'
echo "✅ 转录完成。当前项目: $(cat "$SKILL_DIR/output/.current_project")"
```

---

## 输出契约（交给 /podcastcut-粗剪）
- `1_转录/subtitles_words.json`（字级时间戳）
- `1_转录/speaker_mapping.json`
- `2_分析/sentences.txt`
- `project.json`：`transcribe.status=done`，`speakers` 已填
- `output/.current_project` 指向本项目

下游单元从 `output/.current_project` 读当前项目，无需用户重报路径。

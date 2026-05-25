---
name: podcastcut:粗剪
description: |
  播客粗剪单元（pipeline 第二步）：段落级 AI 内容分析 + 句子级人工审查页。
  通读全文划分话题、按 6 类删除 + 质量优化标记大块 → semantic_deep_analysis.json，
  生成可试听/可编辑的 review_roughcut.html（含半句删除 + 句子序号），用户导出 delete_segments_roughcut.json。
  触发词：粗剪、粗剪分析、段落级分析、生成粗剪审查页、roughcut
---

<!--
input: 2_分析/sentences.txt + 1_转录/subtitles_words.json + speaker_mapping.json + audio_seekable.mp3
       （由 /podcastcut-转录 产出，经 output/.current_project 交接）
output: 2_分析/semantic_deep_analysis.json、review_roughcut.html、(用户)delete_segments_roughcut.json
        project.json(roughcut=awaiting_review)
pos: pipeline 第二步；上游=转录，下游=/podcastcut-精剪

架构守护者：generate_review_roughcut.js / 模板 review_roughcut.html / user_manager.js 暂在 剪播客/scripts(templates)。
未来建 _shared/ 时统一迁移并更新引用。
-->

# 粗剪单元

> 内容级删减：先看懂整期在讲什么，再把"不该进成品的大块"标出来，交给用户在审查页上确认。pipeline 的"内容粗剪"步，独立可调用。

## 这一步删什么（与精剪的分工）
- **粗剪（本单元）= 删大块**：录前准备、技术调试、跑题闲聊、隐私、重复故事、制作讨论，以及信息密度低/啰嗦的段落。**句子级**。
- **精剪（/podcastcut-精剪）= 删口癖语病**：填充词、卡顿、静音、重说纠正、残句。**词级**。
- 两步各自有审查页、各自导出，**导出命名分开**（见红线）。

## 🔴 红线
- 审查页音频用 `1_转录/audio_seekable.mp3`（CBR 192k + Xing header，VBR 会 seek 漂移）。
- 导出命名 **`delete_segments_roughcut.json`**，**不要**用 `delete_segments_edited.json`（那是精剪的最终清单，撞名会被执行单元误吃）。
- 审查页模板用占位符注入（`__SENTENCES_DATA__` 等），生成后必须校验**无样例残留**（不应出现 `雨林/潘潘/阿司` 等示例说话人）。

## 脚本位置
`$SKILL_DIR/剪播客/scripts/`（generate_review_roughcut.js、user_manager.js）、模板 `$SKILL_DIR/剪播客/templates/review_roughcut.html`。

---

## 步骤

### 0. 定位项目

```bash
PROJECT="${PROJECT:-$(cat "$SKILL_DIR/output/.current_project")}"
BASE_DIR="$SKILL_DIR/output/$PROJECT/剪播客"
USER_ID="${PODCASTCUT_USER:-$(node -e "console.log(require('$BASE_DIR/project.json').project.user||'default')")}"
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" roughcut in_progress
```
> 上游契约：`2_分析/sentences.txt`、`1_转录/subtitles_words.json`、`1_转录/audio_seekable.mp3` 应已存在（转录单元产出）。缺失则先跑 `/podcastcut-转录`。

### 1. 加载用户偏好与规则（激进度 / 类型开关）

```javascript
const UserManager = require('$SKILL_DIR/剪播客/scripts/user_manager');
const prefs = UserManager.loadPreferences(USER_ID);
const rules = UserManager.loadEditingRules(USER_ID);
// 优先级：editing_rules.user_overrides.content_analysis > prefs.content_analysis > 基础规则默认
```
- 按 `prefs.content_analysis.detect_types` 决定启用哪些删除类型
- 按 `prefs.duration.aggressiveness` 或 `rules.user_overrides.content_analysis.aggressiveness` 决定激进度

### 2. 段落级 AI 分析 → `semantic_deep_analysis.json`

> 方法论详见 `基础剪辑规则/10-内容分析方法论.md`。采用**两级分析**：先段落级扫描标记大块删除区间，再对边界逐句微调。

**流程**：
1. 通读 `2_分析/sentences.txt` 全文，划分话题段落
2. 按用户 `detect_types` 开关识别启用的删除类型（见下表）
3. 计算各块时长，对比目标时长缺口
4. 如仍需删减，按激进度识别信息密度低的段落 → `delete`
5. **质量优化扫描（始终执行，即使无时长缺口）**：扫描啰嗦重复/过度展开/信息密度低/弱相关细节 → `suggest_delete`
6. 微调每个删除块的边界切点
7. 写出 `2_分析/semantic_deep_analysis.json`

**6 种删除类型**：

| 类型 | 标识 | 说明 |
| --- | --- | --- |
| 录前准备 | `pre_show` | 正式开场白之前的一切内容 |
| 技术调试 | `tech_debug` | 设备问题、录制中断、音频检查 |
| 跑题闲聊 | `chit_chat` | 与主题无关的闲聊 |
| 隐私信息 | `privacy` | 说话人要求删除或敏感个人信息 |
| 重复内容 | `repeated_content` | 同一段故事讲两遍（保简版删详版） |
| 制作讨论 | `production_talk` | 录制中讨论剪辑策略 |

**输出格式**（两级结构）：
```json
{
  "version": "5.0",
  "analysisType": "two_level",
  "totalDuration": "2:08:06 (128min)",
  "targetDuration": "90min",
  "blocks": [
    { "id": 1, "range": [0, 19], "type": "pre_show", "reason": "录前准备：测噪音、谁先开口", "duration": "1:06" }
  ],
  "sentences": [
    { "sentenceIdx": 0, "speaker": "响歌歌", "action": "delete", "blockId": 1, "type": "pre_show" },
    { "sentenceIdx": 20, "speaker": "清扬", "action": "keep" }
  ],
  "summary": { "totalSentences": 1404, "deleteSentences": 227, "deleteBlocks": 13, "totalDeleteDuration": "14:23", "deleteRatio": "16.2%" }
}
```
- `blocks` — 段落级，供人工审核看大块删了什么
- `sentences` — 逐句级，供审查页/下游脚本消费；删句 `action:"delete"`、质量优化 `action:"suggest_delete"`、保留 `action:"keep"`
- 可选 `chapters`（AI 章节分段）：审查页有就用，无则自动均分

### 3. 生成句子级审查页 `review_roughcut.html`

```bash
cd "$BASE_DIR/2_分析"
node "$SKILL_DIR/剪播客/scripts/generate_review_roughcut.js" \
  --sentences sentences.txt \
  --words "$BASE_DIR/1_转录/subtitles_words.json" \
  --analysis semantic_deep_analysis.json \
  --audio "1_转录/audio_seekable.mp3" \
  --output "$BASE_DIR/review_roughcut.html" \
  --title "$PROJECT 粗剪审查（可编辑）"

open "$BASE_DIR/review_roughcut.html"
```

> 模板位于 `templates/review_roughcut.html`，脚本注入 `__SENTENCES_DATA__/__BLOCKS_DATA__/__CHAPTERS_DATA__`。
> 审查页能力：整句删除/恢复（勾选框）、**半句删除**（选中文字→标记，char 级精度）、句子序号、点击跳转试听（动态跳过删除段，无需预剪）、localStorage 自动保存。

### 4. 用户审查 + 导出

让用户在审查页上：
1. 浏览 AI 标记（确定删除 / 建议删除）
2. 用播放器试听效果
3. 勾选/取消勾选整句、或选中文字做半句删除
4. 点"导出"→ 下载 **`delete_segments_roughcut.json`**，拖回对话框

把导出文件放到 `2_分析/`：
```bash
# 用户把下载的 delete_segments_roughcut.json 放到 $BASE_DIR/2_分析/
ls "$BASE_DIR/2_分析/delete_segments_roughcut.json"
```

### 5. 写状态清单（等用户确认）

```bash
# 生成审查页后即置 awaiting_review（pipeline 在此暂停等人工审核）
DELS=$(node -e "try{const a=require('$BASE_DIR/2_分析/semantic_deep_analysis.json');console.log((a.summary&&a.summary.deleteBlocks)||0)}catch(e){console.log(0)}")
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" roughcut awaiting_review \
  --outputs '{"analysis":"2_分析/semantic_deep_analysis.json","review_page":"review_roughcut.html","export":"2_分析/delete_segments_roughcut.json"}' \
  --summary "{\"deleteBlocks\":$DELS}"
```
用户确认导出无误后（口头确认或下游单元启动时）置 `approved`：
```bash
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" roughcut approved --note "用户已审核导出"
```

---

## 输出契约（交给 /podcastcut-精剪）
- `2_分析/semantic_deep_analysis.json`（段落 + 逐句标记）
- `review_roughcut.html`（审查页）
- `2_分析/delete_segments_roughcut.json`（用户导出的粗剪删除清单）
- `project.json`：`roughcut.status=awaiting_review`（用户确认后 `approved`）

下游 `/podcastcut-精剪` 从 `output/.current_project` 读当前项目，对 `keep` 的句子做词级精剪。

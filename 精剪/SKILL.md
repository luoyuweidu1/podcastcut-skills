---
name: podcastcut:精剪
description: |
  播客精剪单元（pipeline 第三步）：词/句级口癖语病删减 + AI 自审查 + 词级人工审查页。
  规则层 + LLM 层 + 合并 + 波形边界精修 → fine_analysis.json，独立 prompt 查漏 → review_agent_catches.json，
  生成 review_enhanced.html（陷阱42 修复 + 半句删除 char 级精度），用户导出 delete_segments_edited.json。
  触发词：精剪、精剪分析、词级分析、口癖删减、AI自审查、生成精剪审查页、fine、refine
---

<!--
input: 2_分析/sentences.txt + semantic_deep_analysis.json(粗剪) + 1_转录/subtitles_words.json + audio_seekable.mp3
       （经 output/.current_project 交接；粗剪应已 awaiting_review/approved）
output: 2_分析/fine_analysis.json、review_enhanced.html、(用户)delete_segments_edited.json
        project.json(fine=awaiting_review)
pos: pipeline 第三步；上游=/podcastcut-粗剪，下游=/podcastcut-执行

架构守护者：run_fine_analysis.js / merge_llm_fine.js / refine_fine_analysis.js / refine_boundaries.py /
generate_review_roughcut.js（**与粗剪共用同一生成器和同一模板 templates/review_roughcut.html**，精剪态靠
传 --fine 和 --roughcut 激活；产物文件名仍为 review_enhanced.html 以区分粗剪页）暂在 剪播客/scripts(templates)。
旧的 generate_review_enhanced.js / templates/review_enhanced.html 已删除（被统一生成器/模板取代）；历史可在 CHANGELOG / git log 中查。
未来建 _shared/ 时统一迁移并更新引用。
-->

# 精剪单元

> 词级删减：在粗剪保留的内容里，逐字逐句删口癖、卡顿、静音、重说纠正、残句。pipeline 的"语言精修"步，独立可调用。

## 这一步删什么（与粗剪的分工）
- **粗剪（/podcastcut-粗剪）= 删大块**：内容级、句子级 → `delete_segments_roughcut.json`
- **精剪（本单元）= 删口癖语病**：填充词/卡顿/静音/重说纠正/残句，**词级** → `delete_segments_edited.json`
- 分析对象 = 粗剪中标记为 `keep` 的句子（已删的不再分析）。

## 🔴 红线
- 审查页音频用 `1_转录/audio_seekable.mp3`（CBR 192k）。
- 最终出片清单是精剪导出的 **`delete_segments_edited.json`**（执行单元默认吃它）。
- 审查页用占位符注入，生成后校验**无样例残留**（不应出现 `雨林/潘潘/阿司`）。

## 脚本位置
`$SKILL_DIR/剪播客/scripts/`（run_fine_analysis.js / merge_llm_fine.js / refine_fine_analysis.js / refine_boundaries.py / generate_review_roughcut.js）、模板 `$SKILL_DIR/剪播客/templates/review_roughcut.html`（**统一模板,与粗剪共用**）。

---

## 步骤

### 0. 定位项目

```bash
PROJECT="${PROJECT:-$(cat "$SKILL_DIR/output/.current_project")}"
BASE_DIR="$SKILL_DIR/output/$PROJECT/剪播客"
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" fine in_progress
```
> 上游契约：`2_分析/sentences.txt`、`semantic_deep_analysis.json`、`1_转录/subtitles_words.json`、`audio_seekable.mp3` 应已存在。缺 `semantic_deep_analysis.json` 则先跑 `/podcastcut-粗剪`。
> **关键**：精剪以用户在粗剪页确认导出的 `2_分析/delete_segments_roughcut.json` 为「保留/删除」底稿（见下「数据流」）。若该文件缺失（用户未导出粗剪），下游脚本自动回退到 AI 的 `semantic_deep_analysis.json` 判断——但应提醒用户：那样精剪反映的是 AI 原始粗剪，不是你的手改。

### 1. 规则层 → `fine_analysis_rules.json`

```bash
node "$SKILL_DIR/剪播客/scripts/run_fine_analysis.js" --analysis-dir "$BASE_DIR/2_分析"
```
高 recall 规则检测：句首填充词（100% recall）、长静音、连续相同词卡顿、后缀匹配卡顿、句中孤立填充词、短语级句内重复、连续填充词、重启信号。部分标记 `needsReview=true` → 交 LLM 层审核。
> 删除句来源：脚本自动优先读 `delete_segments_roughcut.json` 的 `sentence_deletes`（用户决定），否则回退 `semantic_deep_analysis.json`。**只分析用户保留的句子**——你删得越多越省 LLM token，你恢复的句子也能被分析到。运行时 stderr 会打印来源（`roughcut(user)` / `semantic(AI)`）。

### 2. LLM 层（Claude）→ `fine_analysis_llm.json`

分批读取 `sentences.txt`（**50–80 句/批**，防注意力稀释）+ `fine_analysis_rules.json`：
- **⚠️ 必须先读 `基础剪辑规则/LLM精剪prompt模板.md`**，按检测清单逐句校对（像"校对员"而非"读者"）。
- **最高优先级：重说纠正**（`self_correction`，11 种子模式，占 LLM 独有价值 39%）。
- 还检：残句 / 纯填充句 / 重复句（语义判断）、录制讨论、规则层 `needsReview` 的 confirm/reject、规则层补漏（仅 ASR 分词遗漏）。
- 规则层已处理填充词/卡顿/短语重复，LLM **不重复检测**。

LLM 层输出格式（写入 `2_分析/fine_analysis_llm.json`）：
```json
{ "batch_range": [0, 59],
  "edits": [
    {"s": 96, "text": "我，因为我，", "type": "self_correction", "reason": "重说纠正：半截重说", "beforeText": "我，因为我，infj是内向的。", "afterText": "infj是内向的。"}
  ],
  "scan_summary": {"total_sentences": 60, "sentences_with_edits": 8} }
```

### 3. 合并 + 边界精修 → `fine_analysis.json`

```bash
# 合并去重：LLM 文本标记 → 映射回词级时间戳，与规则层合并；rejected 项移除
node "$SKILL_DIR/剪播客/scripts/merge_llm_fine.js" --analysis-dir "$BASE_DIR/2_分析"

# 波形 onset 精修紧密边界（在切点附近搜能量谷底；原版备份 fine_analysis_pre_refine.json）
node "$SKILL_DIR/剪播客/scripts/refine_fine_analysis.js" \
  --analysis-dir "$BASE_DIR/2_分析" \
  --audio "$BASE_DIR/1_转录/audio_seekable.mp3"
```
产出 `2_分析/fine_analysis.json`（词级编辑 `edits[]`，每条带 `sentenceIdx/type/wordRange/deleteText/keepText/reason`，静音带 `duration`）。

### 4. AI 自审查（1.5）→ `review_agent_catches.json` → 合并入 fine

**目的**：用**独立 prompt**（不复用精剪模板）对 5a 粗剪 + 5b 精剪标记**查漏补缺**，替代用户手动逐句检查。

输入：`sentences.txt` + `semantic_deep_analysis.json` + `fine_analysis.json` + `subtitles_words.json`。分 3 轮：
1. **粗剪审查**：keep 段落是否漏了 `production_talk`/跑题？删除块边界是否切句中？
2. **精剪审查（核心）**：对 keep 句按 9 项清单对照 5b 找遗漏，重点 5b 高漏检类型——`self_correction`(50%)、`stutter`(29%，单字代词"我我/他他")、连续填充、`production_talk`。
3. **交叉验证**：5b 是否误标（强调 vs 口误、数字/术语被误删）。

输出 `2_分析/review_agent_catches.json`（`catches[]` + `false_positives[]`），`confidence≥0.7` 的 catch 合并入 `fine_analysis.json` 的 `extraFineEdits`；false_positive 标"待确认"不自动取消。
> `residual_sentence` 阈值用 0.9（断句≠残句，避免误删正常跨句表达）。

### 5. 生成词级审查页 `review_enhanced.html`

```bash
cd "$BASE_DIR/2_分析"
node "$SKILL_DIR/剪播客/scripts/generate_review_roughcut.js" \
  --sentences sentences.txt \
  --words "$BASE_DIR/1_转录/subtitles_words.json" \
  --analysis semantic_deep_analysis.json \
  --fine fine_analysis.json \
  --roughcut delete_segments_roughcut.json \
  --audio "1_转录/audio_seekable.mp3" \
  --output "$BASE_DIR/review_enhanced.html" \
  --title "$PROJECT 精剪审查（可编辑）"

open "$BASE_DIR/review_enhanced.html"
```
> `--roughcut`：整句删除底稿用用户粗剪导出的 `sentence_deletes`（与规则层一致）；文件缺失则回退 AI 判断。stdout 打印来源。
> 词索引用 `actual_words`（跳过 isGap/isSpeakerLabel）；精剪编辑预计算 `ds/de`；动态播放器实时跳过删除段（不预剪）。
> 能力：整句删除/恢复、AI 精剪词级切换、**手动半句删除**（char 级精度，含陷阱42 修复）、修正说话人、Ctrl+Z 撤销、localStorage 自动保存。

### 6. 用户审查 + 导出

用户在审查页：浏览 AI 标记 → 试听 → 词级/半句手动编辑 → 点绿色"导出剪辑文件"→ 下载 **`delete_segments_edited.json`**，拖回对话框放到 `2_分析/`。
```bash
ls "$BASE_DIR/2_分析/delete_segments_edited.json"
```

### 7. 写状态清单（等用户确认）

```bash
FE=$(node -e "try{const a=require('$BASE_DIR/2_分析/fine_analysis.json');console.log((a.summary&&a.summary.totalEdits)||(a.edits&&a.edits.length)||0)}catch(e){console.log(0)}")
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" fine awaiting_review \
  --outputs '{"analysis":"2_分析/fine_analysis.json","review_page":"review_enhanced.html","export":"2_分析/delete_segments_edited.json"}' \
  --summary "{\"fineEdits\":$FE}"
```
用户确认导出无误后置 `approved`：
```bash
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" fine approved --note "用户已审核导出"
```

---

## 数据流说明（粗剪 → 精剪）
精剪以用户在粗剪页确认导出的 **`delete_segments_roughcut.json` 为整句保留/删除底稿**：
- 该导出在 `segments`（时间段，供 cut_audio）之外还带 **`sentence_deletes`**（句索引数组，用户的最终整句决定）与 `partial_deletes`（半句删除）。
- `run_fine_analysis.js` 和 `generate_review_roughcut.js` 都**优先读 `sentence_deletes`**（用户决定），缺失才回退 `semantic_deep_analysis.json`（AI 判断）。
- 因此用户在粗剪页的整句增删**会**反映到精剪：恢复的句子会被精剪分析并显示为保留，删掉的句子被跳过、不浪费 LLM token、也不出现在精剪页。
- **`semantic_deep_analysis.json` 不被改写**——反馈/评估闭环（2.3/2.4）靠它对比「AI 原判 vs 用户修正」，改写会抹掉这个学习信号。
- 粗剪的**半句删除**(`partial_deletes`)也会带入：统一生成器把 `delete_segments_roughcut.json` 的 `partial_deletes` 注入模板的 `__ROUGHCUT_PARTIALS_DATA__` 占位符，模板初始化为 `const pdel = __ROUGHCUT_PARTIALS_DATA__`（即 sentenceIdx → 半句区间数组），由 `rs()` 在存档存在时覆盖。用户在精剪页可继续编辑/恢复它们（点击划线即恢复）。

> **最终出片以精剪导出的 `delete_segments_edited.json` 为准。**

## 输出契约（交给 /podcastcut-执行）
- `2_分析/fine_analysis.json`（词级编辑）
- `review_enhanced.html`（审查页）
- `2_分析/delete_segments_edited.json`（用户导出的最终删除清单）
- `project.json`：`fine.status=awaiting_review`（用户确认后 `approved`）

下游 `/podcastcut-执行` 从 `output/.current_project` 读项目，吃 `delete_segments_edited.json` + `audio_original.*` 出片。

## 反馈学习 / 评估（可选闭环）
精剪导出后，审查页"导出 AI 反馈"(蓝色) → `ai_feedback_*.json`，可经 `analyze_feedback.js` / `apply_feedback_to_rules.js` 回写用户偏好，并由 `calculate_eval_metrics.js` 记 precision/recall 趋势。此闭环仍由编排器（剪播客）阶段2.3/2.4 承载，非本单元必跑步骤。

---
name: podcastcut:剪播客
description: |
  播客剪辑编排器：把整期播客从转录到成品串起来，按状态清单 project.json 逐步推进，
  每步暂停等你审核，可"继续"续跑。各步是独立单元（转录/粗剪/精剪/执行/质检/音质处理/后期）。
  触发词：剪播客、处理播客、编辑音频、继续剪辑、继续
---

<!--
架构守护者：我是**瘦编排器**，只串流程、不内联实现。修改我时同步更新：
1. ../README.md 的 Skill 清单  2. /CLAUDE.md 路由表  3. CHANGELOG.md
各单元的 SKILL.md 才是各阶段的"真源"；参考资料（陷阱/FAQ/数据格式/波形/反馈闭环）在 剪播客/参考/。
单元交接 = output/<项目>/剪播客/project.json + output/.current_project 指针（契约见 docs/refactor/project-manifest.md）。
-->

# 剪播客 · 编排器

> 阿里云 FunASR 转录 + Claude 语义分析 + 网页审核 + 自动剪辑 + 个性化偏好学习。
> **这是编排器**：本身不剪辑，而是按 `project.json` 依次调用各独立单元，在每个需审核处**停下等你确认**，确认后再继续。可随时"继续"从上次断点续跑。

## 🔴 音质保护红线（全流程强制）

以下规则在任何阶段、任何脚本中都**不可违反**：

1. **用户可听的音频永远不低于 192kbps** — 审查页、成品、highlight 片段都必须 ≥192kbps CBR
2. **只有 ASR 转录用的音频才允许降采样** — `audio.mp3`（16kHz mono）仅供 FunASR，不可用于播放/剪辑
3. **剪辑必须基于原始音频** — `cut_audio.py` 必须用 `audio_original.*`，禁止用 `audio.mp3`
4. **禁止静音替换** — 需移除的片段必须直接剪掉（cut），不得用静音填充
5. **禁止未经用户确认的破坏性音频修改**（静音替换、降采样、格式转换等）

```
音频文件层级：
  audio_original.*      → 剪辑用（原始质量，不可修改）
  audio.mp3             → 转录用（16kHz mono，仅 ASR）
  audio_seekable.mp3    → 审查页用（CBR 192k，精确 seek）
  *_精剪版_*.mp3        → 成品（从 audio_original 剪辑，≥192kbps）
```

## 流水线总览（编排顺序）

| 步 | 阶段id | 单元 | 审核? | 关键产物 |
|----|--------|------|-------|----------|
| 1 | `transcribe` | /podcastcut-转录 | 否 | subtitles_words.json、sentences.txt、speaker_mapping.json |
| 2 | `roughcut` | /podcastcut-粗剪 | ✅ 暂停 | semantic_deep_analysis.json、review_roughcut.html →`delete_segments_roughcut.json` |
| 3 | `fine` | /podcastcut-精剪 | ✅ 暂停 | fine_analysis.json、review_enhanced.html →`delete_segments_edited.json` |
| 4 | `execute` | /podcastcut-执行 | 否 | 3_成品/*_精剪版_vN.mp3 + *_trimmed.mp3 |
| 5 | `qa` | /podcastcut-质检 | ✅(可选) | 质检报告（数据/信号/语义层） |
| 6 | `audio_quality` | /podcastcut-音质处理 | ✅(可选) | 音质处理版 mp3 |
| 7 | `post` | /podcastcut-后期 | ✅(可选) | 高光/片头/章节/标题/简介 |

- **manifest 驱动**：每个单元自己写 `project.json` 的阶段状态；编排器读 `current_stage` + 各 `status` 决定下一步。
- **暂停点**：`roughcut` / `fine`（及可选步）跑完置 `awaiting_review`，编排器**停下**展示审查页、等用户审核导出，用户确认后置 `approved` 再继续。
- **续跑**：`output/.current_project` 指向当前项目；用户说"继续"即从第一个未完成阶段接着跑。
- 状态机：`pending → in_progress → (awaiting_review → approved) | done`；可选步未启用置 `skipped`。

## 快速使用

```
用户: 帮我剪这个播客，3个说话人：麦雅、响歌歌、安安
用户: 处理这个播客 /path/to/audio.mp3，2个主播
用户: 继续        ← 从上次断点续跑
```

**必需输入**：① 音频文件路径 ② **说话人数量**（必须用户提供，不可自行猜测——设错会大幅降低识别率）③ 说话人姓名。
> ⚠️ 用户未给说话人数量时**必须先问**。

**🚫 CRITICAL：永远不要 regenerate `review_roughcut.html` / `review_enhanced.html` 覆盖用户已审查的文件！**
用户手动编辑存在 HTML 内 localStorage 状态里，regenerate 会彻底丢失。需更新模板逻辑只改 `templates/`，让用户刷新；确需 regenerate 必须先备份并告知用户、等确认。

## 输出目录结构

```
output/
├── .current_project                 # 当前项目 id 指针（"继续"读它）
└── YYYY-MM-DD_音频名/剪播客/
    ├── project.json                 # 状态清单（编排/续跑/未来网页 stepper 的数据源）
    ├── 1_转录/  (audio_original.* / audio.mp3 / audio_seekable.mp3 / subtitles_words.json / speaker_mapping.json)
    ├── 2_分析/  (sentences.txt / semantic_deep_analysis.json / fine_analysis.json / delete_segments_roughcut.json / delete_segments_edited.json)
    ├── 3_成品/  (*_精剪版_vN.mp3 / *_trimmed.mp3 / *_final.mp3)
    ├── review_roughcut.html / review_enhanced.html / review_final.html
```

---

## 编排步骤

### 0. Onboarding 前置门（首跑 / 换用户时）

**这是进入流程前的门，不是流水线阶段。** 用户说"剪播客"后先确认用户身份与偏好：

```bash
cd "$SKILL_DIR/剪播客"
USER_ID="${PODCASTCUT_USER:-default}"
node scripts/user_manager.js list                 # 列出已有用户
node scripts/user_manager.js check "$USER_ID"     # 检查是否存在 + 是否已配置
```

- **已有且已配置** → 一句话确认："已加载你的偏好。今天处理什么音频？几个说话人？"（老用户回访），进入步骤 1。
- **新用户 / 未配置** → 先建档，再进流程：
  ```bash
  node scripts/user_manager.js create "$USER_ID"   # 从 default/ 克隆
  ```
  **建档对话（1-2 轮）**：
  - **路径 A（有往期样本，最精准）**：转录"剪辑前+剪辑后"两版 → `analyze_editing_samples.py` → `generate_rule_overrides.js <userId>` → 呈现偏好表让用户确认 → 存 `editing_rules/`。
  - **路径 B（无样本）**：一条消息问全：① 播客类型（受众、目的）② 理想时长 + 激进度（conservative 10-20% / moderate 20-35% / aggressive 35-50%）③ 特殊需求（如保留语气词、大力删卡顿）。未答用保守默认。
  - 后期偏好延迟到首次用后期单元时再问。

> 偏好位置 `用户偏好/<userId>/`（gitignored）。改偏好：`user_manager.js prefs/rules <id>`，或直接说"更新我的默认时长为90分钟"。运行时带 `PODCASTCUT_USER=<id>`。

### 1. 定位项目 / 续跑判定

```bash
# 续跑：读当前项目与状态，找第一个未完成阶段
PROJECT=$(cat "$SKILL_DIR/output/.current_project" 2>/dev/null)
[ -n "$PROJECT" ] && node "$SKILL_DIR/剪播客/scripts/manifest.js" get "$SKILL_DIR/output/$PROJECT/剪播客" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('当前阶段:',m.current_stage);m.pipeline.forEach(p=>console.log(' ',p.id,p.status))})"
```

- **新项目**（用户给了新音频）→ 直接进入"转录"（转录单元会建目录 + `manifest init` + 写 `.current_project`）。
- **继续**（用户说"继续"）→ 按上面读出的 `current_stage`，从步骤 2 对应阶段接着跑。

### 2. 编排循环（按 `current_stage` 派发到单元）

> 规范：**连续推进、统一汇报**。无审核的步骤（转录、执行）跑完直接进下一步、不中途汇报；遇到 `awaiting_review` 才停下交给用户。

| current_stage | 动作 |
|---------------|------|
| `transcribe` | 调 **/podcastcut-转录**（传音频 + 说话人数量/姓名）。完成（done）→ 自动进 `roughcut`。|
| `roughcut` | 调 **/podcastcut-粗剪** → 置 `awaiting_review`。**停**：打开 `review_roughcut.html`，等用户审核、导出 `delete_segments_roughcut.json` 回 `2_分析/`、口头确认。|
| `fine` | 调 **/podcastcut-精剪** → 置 `awaiting_review`。**停**：打开 `review_enhanced.html`，等用户审核、导出 `delete_segments_edited.json`、确认。|
| `execute` | 调 **/podcastcut-执行**（吃 `delete_segments_edited.json`，无则回退 roughcut）。完成→进可选步。|
| `qa` | 若 `preferences.yaml` 的 `workflow_automation.auto_qa_enabled` → 调 **/podcastcut-质检**；否则 `skipped`。发现问题→提示用户回精剪调整（见终审）。|
| `audio_quality` | 用户需要则调 **/podcastcut-音质处理**（按说话人降噪/去回声 + 响度标准化 -16 LUFS）；否则 `skipped`。|
| `post` | 若 `workflow_automation.auto_post_production` → 调 **/podcastcut-后期**（首次先问后期偏好存 `post_production.yaml`）；否则 `skipped`。|

**用户确认审核后**，把该步标 `approved` 再继续：
```bash
BASE_DIR="$SKILL_DIR/output/$(cat "$SKILL_DIR/output/.current_project")/剪播客"
node "$SKILL_DIR/剪播客/scripts/manifest.js" set-stage "$BASE_DIR" <roughcut|fine|qa|audio_quality|post> approved --note "用户已审核"
```
跳过可选步：`set-stage "$BASE_DIR" <qa|audio_quality|post> skipped`。

**终审（可选，质检发现问题时）**：生成 `review_final.html`（`generate_review_final.js`，内嵌成品播放器 + 质检问题列表 + 可点时间戳），用户终审；"需重剪"→回 `fine`/`audio_quality` 调整；"通过"→`user_manager.js appendEpisode` 记 `episode_history.json`。

## 反馈学习 / 评估（可选闭环）

审查页"导出 AI 反馈"(蓝色) → `ai_feedback_*.json`，可回写用户偏好（`analyze_feedback.js`/`apply_feedback_to_rules.js`）并记 precision/recall 趋势（`calculate_eval_metrics.js`）。
**详见 [`参考/反馈学习与评估.md`](参考/反馈学习与评估.md)**（原 2.3/2.4 + 内建自进化说明）。

## 参考资料（从编排器拆出，需要时查阅）

- [`参考/技术陷阱与波形.md`](参考/技术陷阱与波形.md) — 陷阱 1-42 + 波形边界校准/onset 精修算法
- [`参考/配置与数据格式与FAQ.md`](参考/配置与数据格式与FAQ.md) — 阿里云 API Key、数据格式、剪辑建议、FAQ、版本历史
- [`参考/反馈学习与评估.md`](参考/反馈学习与评估.md) — 反馈闭环 + 评估指标
- 各阶段细节看对应单元的 SKILL.md：`转录/ 粗剪/ 精剪/ 执行/ 质检/ 音质处理/ 后期/`
- 基础剪辑规则：`基础剪辑规则/`（共享）+ `用户偏好/<userId>/`（个人覆盖）

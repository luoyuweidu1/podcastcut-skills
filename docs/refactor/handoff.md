# 重构交接 Prompt（Phase 3 续接）

> 复制下面整段给新会话即可无缝继续。

---

我在把一个播客剪辑 skill 从单体重构成模块化单元（strangler-fig 渐进式），现在要继续 **Phase 3**。请先读记忆文件 `arch-refactor-plan.md`、`project-podcastcut-collab.md`、`env-t9-exfat-breaks-git.md` 和仓库里的 `docs/refactor/project-manifest.md`，再开工。

## 环境与位置
- 仓库（技能后端）：`~/Coding/podcastcut-skill-v2/podcastcut-skills`（内置 APFS 盘）。
- ⚠️ **`/Volumes/T9` 是 exFAT，会搞坏 git**——所有 git 操作都在内置盘做。`SKILL_DIR` 在 `~/.zshenv`（非交互 shell 也能读），值=仓库路径。`output/` 软链到 T9（大音频），所以 T9 要插着。
- 技能通过 `~/.claude/skills/podcastcut-<名>` 软链接注册。
- 当前分支 `refactor/phase0-manifest`：已有 phase0/1/2 共 8 个提交，**本地未推**；它叠在 PR #16（半句删除）的提交之上。等 PR #16 合并后 rebase 到 main 再提 PR；分支可改个跨 phase 的名。

## 架构目标
单体 `剪播客/SKILL.md`（曾 2012 行）拆成小单元 + 瘦编排器 + `project.json` 状态清单，终极做成网页 Agent（顶部 stepper，每步做完用户 check 才 complete）。**每步暂停等用户审核**是确定的设计。单元交接 = `output/<项目>/剪播客/project.json` + `output/.current_project` 指针。契约见 `docs/refactor/project-manifest.md`（v1 已冻结）。

## 已完成
- **Phase 0**：`剪播客/scripts/manifest.js`（init/set-stage/set-speakers/set-audio/get/current）；meeting_02 已回填验证过 `project.json`。
- **Phase 1**：`转录/`=`podcastcut:转录`（修了 aliyun_funasr_transcribe.sh 的 0 字节下载 bug）。
- **Phase 2**：`执行/`=`podcastcut:执行`（cut_audio.py + trim_silences.py）。
- 大技能已委托转录、执行两段，2024→1871 行。

## Phase 3 任务：抽「粗剪」+「精剪」两个单元
- **粗剪**：大技能 `#### 1.3 粗剪分析`（段落级 AI 分析→`semantic_deep_analysis.json`）+ `阶段2 人工审核`（`generate_review_roughcut.js`→`review_roughcut.html`，句子级 + 已加的半句删除/序号）。用户导出 `delete_segments_roughcut.json`。
- **精剪**：`#### 1.4 精剪分析`（`run_fine_analysis.js` 规则层 + LLM 层 + `merge_llm_fine.js` + `refine_fine_analysis.js`）+ `#### 1.5 AI 自审查`，审查页 `review_enhanced.html`（word 级，含陷阱42 修复 + 半句删除 char 级精度）。用户导出 `delete_segments_edited.json`。

## 抽单元的既定套路（照 转录/执行 做）
1. 建 `<单元>/SKILL.md`，frontmatter：`name: podcastcut:<名>` + `description: |` 带「触发词：…」。
2. **脚本不要移动**（很多被 质检/后期/安装 共用），单元里用 `$SKILL_DIR/剪播客/scripts/...` 引用现位置；待以后 `_shared/` 阶段统一迁移。
3. 单元开头 set-stage `<阶段> in_progress`，结尾 set-stage `<阶段> awaiting_review`（粗剪/精剪都需人工审核→awaiting_review，用户确认后再 approved）。
4. 从 `output/.current_project` 读项目：`PROJECT=$(cat "$SKILL_DIR/output/.current_project"); BASE_DIR="$SKILL_DIR/output/$PROJECT/剪播客"`。
5. 注册软链接：`ln -sfn "$PWD/<单元>" ~/.claude/skills/podcastcut-<名>`。
6. 大技能里把对应段落换成「→ 委托 /podcastcut-<名>」。**注意 `剪播客/SKILL.md` 里有历史 mojibake 乱码字符**，所以用 **node 按行号替换 + 锚点断言**（不要靠内容字符串匹配 Edit）。

## 验证（不花 API）
- 模板 JS：抽出 `<script>` 跑 `node --check`。
- 用 meeting_02 现有数据重新生成审查页（它已有 `aliyun_funasr_transcription.json`/`subtitles_words.json`/`sentences.txt`/`semantic_deep_analysis.json`，状态在 roughcut awaiting_review）。
- 改完每段提交；每个单元注册后确认出现在技能列表。

## 红线/坑
- 剪辑必须用 `audio_original.*`，禁用 `audio.mp3`；成品 ≥192k。
- 导出命名：粗剪 `delete_segments_roughcut.json`、精剪 `delete_segments_edited.json`（别撞名）。
- 审查页模板曾把样例数据烤死（应是 `__SENTENCES_DATA__`/`__BLOCKS_DATA__` 占位符，不是真数据）——生成后务必校验注入正确、无 `雨林/潘潘` 残留。

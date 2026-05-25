# 重构交接 Prompt（Phase 4 续接）

> 复制下面整段给新会话即可无缝继续。

---

我在把一个播客剪辑 skill 从单体重构成模块化单元（strangler-fig 渐进式），现在要继续 **Phase 4**。请先读记忆文件 `arch-refactor-plan.md`、`project-podcastcut-collab.md`、`env-t9-exfat-breaks-git.md` 和仓库里的 `docs/refactor/project-manifest.md`，再开工。

## 环境与位置
- 仓库（技能后端）：`~/Coding/podcastcut-skill-v2/podcastcut-skills`（内置 APFS 盘）。
- ⚠️ **`/Volumes/T9` 是 exFAT，会搞坏 git**——所有 git 操作都在内置盘做。`SKILL_DIR` 在 `~/.zshenv`（非交互 shell 也能读），值=仓库路径。`output/` 软链到 T9（大音频），所以 T9 要插着。Bash 工具每次会把 cwd 重置到 T9，命令里用绝对路径或先 `cd` 进内置盘仓库。
- 技能通过 `~/.claude/skills/podcastcut-<名>` 软链接注册。
- 当前分支 `refactor/phase0-manifest`：已有 phase0/1/2/3 共 10 个提交，**本地未推**；它叠在 PR #16（半句删除）的提交之上。等 PR #16 合并后 rebase 到 main 再提 PR；分支可改个跨 phase 的名。

## 架构目标
单体 `剪播客/SKILL.md`（曾 2012 行，现 1433 行）拆成小单元 + 瘦编排器 + `project.json` 状态清单，终极做成网页 Agent（顶部 stepper，每步做完用户 check 才 complete）。**每步暂停等用户审核**是确定的设计。单元交接 = `output/<项目>/剪播客/project.json` + `output/.current_project` 指针。契约见 `docs/refactor/project-manifest.md`（v1 已冻结）。

## 已完成
- **Phase 0**：`剪播客/scripts/manifest.js`（init/set-stage/set-speakers/set-audio/get/current）；meeting_02 已回填验证 `project.json`。
- **Phase 1**：`转录/`=`podcastcut:转录`（修了 aliyun_funasr_transcribe.sh 的 0 字节下载 bug）。
- **Phase 2**：`执行/`=`podcastcut:执行`（cut_audio.py + trim_silences.py）。
- **Phase 3**：`粗剪/`=`podcastcut:粗剪`（1.3 段落分析 + review_roughcut.html 句子级 → `delete_segments_roughcut.json`）；`精剪/`=`podcastcut:精剪`（1.4 规则/LLM/merge/refine + 1.5 自审查 + review_enhanced.html 词级 → `delete_segments_edited.json`）。改了 review_roughcut.html 导出名。大技能 1.3/1.4/1.5/阶段2 已委托。
- 大技能已委托转录/粗剪/精剪/执行四步。

## Phase 4 任务：瘦编排器 + onboarding 首跑
- **瘦编排器**：`剪播客/SKILL.md` 收成一个 chain——按 `project.json` 的 `current_stage` + 各 `status` 决定下一步调哪个单元（转录→粗剪→精剪→执行→可选 质检/音质/后期），在每个 `awaiting_review` 处停下等用户确认（确认后置 `approved` 再继续）。支持「继续」：读 `.current_project`→manifest→找第一个未完成阶段接着跑。
- **onboarding 首跑**：转录/编排器启动时检查 `用户偏好/<user>/` 是否存在且 `isConfigured`，否则先触发建档（不是流水线阶段，是前置条件）。
- 删死 `自进化/`（无 SKILL.md）。考虑把共享脚本/基础剪辑规则/用户偏好抽到 `_shared/`（可留到后续）。

## 既定套路（照 转录/执行/粗剪/精剪 做）
1. 单元 `<名>/SKILL.md`，frontmatter `name: podcastcut:<名>` + `description: |` 带「触发词：…」。
2. **脚本不要移动**（被多技能共用），单元里用 `$SKILL_DIR/剪播客/scripts/...` 引用现位置；待 `_shared/` 阶段统一迁移。
3. 从 `output/.current_project` 读项目；manifest 写各自阶段状态。
4. 注册软链接 `ln -sfn "$PWD/<单元>" ~/.claude/skills/podcastcut-<名>`。
5. 大技能里把对应段换成「→ 委托 /podcastcut-<名>」。**注意 `剪播客/SKILL.md` 含历史 mojibake 乱码**，改它用 **node 按行号 splice + 锚点断言**（断言 ASCII-safe 的 header 前缀，不要靠内容字符串匹配 Edit）。

## 验证（不花 API）
- 用 meeting_02 现有数据（`output/2026-05-25_meeting_02/`，roughcut awaiting_review）跑编排流程的"续跑"判定逻辑；模板 JS 用 `vm.Script` 编译校验。
- 改完每段提交（本地，别推）。

## 红线/坑
- 剪辑必须用 `audio_original.*`，禁用 `audio.mp3`；成品 ≥192k。
- 导出命名：粗剪 `delete_segments_roughcut.json`、精剪 `delete_segments_edited.json`（执行单元默认吃精剪的，回退粗剪的）。
- 审查页模板用占位符注入（`__SENTENCES_DATA__` 等），生成后校验无 `雨林/潘潘` 样例残留。
- **Phase 3 gap 已修（方案1/串行，commit `21a8d4f`）**：粗剪导出 `delete_segments_roughcut.json` 现带 `sentence_deletes`(用户整句决定)+`partial_deletes`；`run_fine_analysis.js`/`generate_review_enhanced.js` 优先读它（缺失回退 AI 的 semantic）。精剪只分析用户保留句。`semantic_deep_analysis.json` 不改写（反馈闭环靠它）。**仍待办（小）**：半句 `partial_deletes` 尚未叠进精剪页显示。

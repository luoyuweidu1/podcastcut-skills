# 重构交接 Prompt（Phase 5 续接 / 收尾）

> 复制下面整段给新会话即可无缝继续。

---

我在把一个播客剪辑 skill 从单体重构成模块化单元（strangler-fig 渐进式）。**Phase 0–4 已全部完成**——单体已拆成单元 + 瘦编排器。请先读记忆文件 `arch-refactor-plan.md`、`project-podcastcut-collab.md`、`env-t9-exfat-breaks-git.md` 和 `docs/refactor/project-manifest.md`，再决定下一步。

## 环境与位置
- 仓库（技能后端）：`~/Coding/podcastcut-skill-v2/podcastcut-skills`（内置 APFS 盘）。
- ⚠️ **`/Volumes/T9` 是 exFAT，会搞坏 git**——所有 git 在内置盘做。`SKILL_DIR` 在 `~/.zshenv`。`output/` 软链到 T9（大音频），T9 要插着。Bash 工具每次把 cwd 重置到 T9，命令用绝对路径或先 `cd`。
- 技能通过 `~/.claude/skills/podcastcut-<名>` 软链接注册（安装/剪播客/转录/粗剪/精剪/执行/质检/音质处理/后期 都已注册）。
- 当前分支 `refactor/phase0-manifest`：含 phase0–4 + 方案1 提交，**本地未推**，叠在 PR #16 上。等 PR #16 合并后 rebase 到 main 再提 PR。分支名已跨 phase0–4，建议改名（如 `refactor/units-and-orchestrator`）。

## 架构现状（已落地）
单体 `剪播客/SKILL.md`（曾 2012 行）已变成 **155 行瘦编排器**：红线 + 流水线总览表 + onboarding 内联前置门 + 定位/续跑 + 按 `current_stage` 派发各单元 + awaiting_review 暂停审核。各单元独立：`转录/粗剪/精剪/执行/质检/音质处理/后期`，经 `output/<项目>/剪播客/project.json` + `output/.current_project` 交接（契约 `docs/refactor/project-manifest.md` v1 冻结）。参考资料在 `剪播客/参考/`。

## 已完成
- **Phase 0**：`manifest.js` 状态清单帮手。
- **Phase 1**：`转录/`（修 0 字节下载 bug）。
- **Phase 2**：`执行/`（cut_audio + trim_silences）。
- **Phase 3**：`粗剪/` + `精剪/`，大技能委托；review_roughcut 导出改名。
- **方案1（粗剪→精剪 交接）**：粗剪导出带 `sentence_deletes`+`partial_deletes`；run_fine_analysis/generate_review_enhanced 优先读它（缺失回退 AI）；半句删除带入精剪页。semantic_deep_analysis.json 不改写（反馈闭环依赖）。
- **Phase 4**：大技能瘦身成编排器（1432→155 行）；参考资料拆到 `剪播客/参考/`；删死 `自进化/`；README skill 清单补全。onboarding = 内联前置门。

## 下一步（任选）
- **Phase 5：网页 Agent UI**（主线，可能在 `chenyusi/podcastcut-web`）：顶部 stepper 读 `project.json` 的 `pipeline[].status` 渲染；`awaiting_review` 步显示"去审查"按钮，用户 check 后置 `approved`。`.current_project` + manifest 已是现成数据源。
- **收尾（可选）**：① `_shared/` 抽取——脚本/基础剪辑规则/用户偏好仍在 `剪播客/` 下，被多单元共用，建 `_shared/` 统一迁移并更新所有 `$SKILL_DIR/剪播客/scripts/...` 引用；② 把 `参考/技术陷阱与波形.md` 里的陷阱按单元分发到各 SKILL.md（更彻底的模块化）；③ 各单元里"见剪播客陷阱 N"的引用改指 `参考/技术陷阱与波形.md`。

## 套路（照已完成单元做）
1. 单元 `<名>/SKILL.md`，frontmatter `name: podcastcut:<名>` + `description: |` 带「触发词：…」。
2. **脚本不要移动**（除非做 _shared 迁移），用 `$SKILL_DIR/剪播客/scripts/...` 引用。
3. 从 `output/.current_project` 读项目；manifest 写各自阶段状态。
4. 软链接注册 `ln -sfn`。
5. **改 `剪播客/SKILL.md` 现在安全**（已重写、无 mojibake，可正常 Edit）；但若再遇 mojibake 文件，用 node 按行号 splice + 锚点断言。

## 验证（不花 API）
- 模板 JS 用 `vm.Script` 编译校验；用 meeting_02 现有数据（`output/2026-05-25_meeting_02/`，roughcut awaiting_review）重生成审查页并校验注入。
- 改完每段提交（本地，别推）。

## 红线/坑
- 剪辑必须用 `audio_original.*`，禁用 `audio.mp3`；成品 ≥192k。
- 导出命名：粗剪 `delete_segments_roughcut.json`、精剪 `delete_segments_edited.json`（执行单元默认吃精剪的，回退粗剪的）。
- 审查页模板用占位符注入，生成后校验无 `雨林/潘潘` 样例残留。
- 🚫 不要 regenerate 覆盖用户已审查的 review_*.html（localStorage 手改会丢）。
- 详细陷阱（1-42）见 `剪播客/参考/技术陷阱与波形.md`。

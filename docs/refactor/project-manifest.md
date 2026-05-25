# `project.json` 契约设计稿（v0 草案，待敲定）

> 状态清单 = 拆分后各单元的**交接契约** + 编排器的**续跑依据** + 未来网页 Agent 的 **stepper 数据源**。一份 schema，三处复用。
> 本文是设计稿，**不改现有代码**。字段定下来后再让现有大技能开始写它。

---

## 1. 设计原则

1. **单一事实来源**：一个项目（一期播客）的全部状态都在 `project.json` 里。任何单元、编排器、网页 UI 都只读它来判断"现在在哪一步、产物在哪"。
2. **文件即接口**：单元之间不直接传参，而是通过项目目录里的约定文件交接。manifest 记录每步的关键产物路径。
3. **幂等可续跑**：单元被调用时先看 manifest——输入齐了才跑、产物已存在就跳过（如转录不重复花 API 钱）。
4. **人工审核是一等公民**：每个需要审核的步骤有 `awaiting_review → approved` 两态，直接映射网页 stepper 的"做完 → user check → complete"。
5. **静态契约与动态状态分离**：哪个阶段吃什么/产什么是**静态**的（见 §6，所有项目一样）；`project.json` 只存**动态状态**（每个项目不同）。

---

## 2. 位置与"当前项目"指针

```
output/
├── .current_project          # 单行文本：当前项目 id（给"继续"用，CLI/编排器读）
├── 2026-05-25_meeting_02/
│   └── 剪播客/
│       ├── project.json       # ← 本契约
│       ├── 1_转录/ 2_分析/ 3_成品/
│       └── review_roughcut.html ...
```

- **`project.json`** 放在每个项目的 `剪播客/` 目录下。
- **`output/.current_project`** 是一个轻量指针：用户说"继续/精剪"时，编排器读它知道操作哪个项目，无需用户重报路径。（网页 UI 自己在前端记当前项目，这个指针主要服务 CLI/对话流。）

---

## 3. 阶段状态机（stepper 的状态）

```
pending ──▶ in_progress ──▶ done                     (无审核的步骤：转录、执行)
pending ──▶ in_progress ──▶ awaiting_review ──▶ approved   (有审核的步骤：粗剪、精剪、后期…)
                                  └──▶ (用户"需重做") ──▶ in_progress
任意 ──▶ skipped   (可选步骤被跳过，如音质处理)
任意 ──▶ failed    (出错，带 error 信息)
```

- **"完成"** = `done | approved | skipped`（stepper 打勾）
- `awaiting_review` = 网页上"等你 check"的高亮态
- `in_progress` 主要给 UI 显示转圈；CLI 流程里可能一闪而过

---

## 4. Schema（以 meeting_02 为例填充）

```jsonc
{
  "schema_version": "1.0",

  // ── 项目级元信息 ──
  "project": {
    "id": "2026-05-25_meeting_02",
    "title": "EP·清扬×响歌歌：回国决定",
    "user": "xianggege",
    "created_at": "2026-05-25T17:00:00-04:00",
    "updated_at": "2026-05-25T18:35:00-04:00",
    "base_dir": "output/2026-05-25_meeting_02/剪播客"
  },

  // ── 音频（各派生文件 + 元信息）──
  "audio": {
    "source": "/Users/xiangli/Documents/VooVMeeting/2026-02-23 19.34.09.823/meeting_02.m4a",
    "original": "1_转录/audio_original.m4a",   // 剪辑用
    "asr": "1_转录/audio.mp3",                  // 16k 转录用
    "seekable": "1_转录/audio_seekable.mp3",    // 192k 审查页用
    "duration_sec": 3346.4,
    "sample_rate": 32000,
    "channels": 1
  },

  // ── 说话人 ──
  "speakers": {
    "count": 2,
    "mapping": { "0": "清扬", "1": "响歌歌" },
    "verified": true                            // 是否已人工/内容确认
  },

  // ── 流水线（stepper 的数据源）──
  "current_stage": "roughcut",
  "pipeline": [
    {
      "id": "transcribe",
      "label": "转录",
      "status": "done",
      "optional": false,
      "needs_review": false,
      "started_at": "2026-05-25T17:01:00-04:00",
      "completed_at": "2026-05-25T17:05:00-04:00",
      "outputs": {
        "subtitles": "1_转录/subtitles_words.json",
        "sentences": "2_分析/sentences.txt"
      },
      "summary": { "sentences": 464, "words": 9635, "asr": "aliyun_funasr" }
    },
    {
      "id": "roughcut",
      "label": "粗剪",
      "status": "awaiting_review",
      "optional": false,
      "needs_review": true,
      "started_at": "2026-05-25T17:06:00-04:00",
      "completed_at": null,
      "outputs": {
        "analysis": "2_分析/semantic_deep_analysis.json",
        "review_page": "review_roughcut.html",
        "export": "2_分析/delete_segments_roughcut.json"   // 用户从审查页导出后填入
      },
      "summary": { "delete_sentences": 3, "suggest_sentences": 4, "chapters": 7 },
      "review": { "approved_at": null, "by": null, "notes": "" }
    },
    {
      "id": "fine",
      "label": "精剪",
      "status": "pending",
      "optional": false,
      "needs_review": true,
      "outputs": {
        "analysis": "2_分析/fine_analysis.json",
        "review_page": "review_enhanced.html",
        "export": "2_分析/delete_segments_edited.json"
      },
      "review": { "approved_at": null, "by": null, "notes": "" }
    },
    {
      "id": "execute",
      "label": "执行剪辑",
      "status": "pending",
      "optional": false,
      "needs_review": false,
      "inputs_from": "fine.export",                 // 引用上游产物
      "outputs": { "products": ["3_成品/meeting_02_精剪版_v1.mp3"] }   // 数组：记重剪 v1/v2/v3 历史
    },
    { "id": "qa",            "label": "质检",     "status": "pending", "optional": true,  "needs_review": true },
    { "id": "audio_quality", "label": "音质处理", "status": "pending", "optional": true,  "needs_review": true },
    { "id": "post",          "label": "后期",     "status": "pending", "optional": true,  "needs_review": true }
  ]
}
```

---

## 5. 各消费方怎么用它

| 消费方 | 怎么用 |
|--------|--------|
| **某个单元**（如精剪） | 启动时读 manifest：检查上游 `roughcut.status==approved` 且 `roughcut.outputs.export` 存在 → 才跑；跑完写自己的 outputs + `status=awaiting_review` |
| **瘦编排器** | 读 `current_stage` + 各 `status`，决定"下一步调哪个单元 / 在 awaiting_review 处停下等用户" |
| **"继续"指令** | 读 `.current_project` → 读 manifest → 找到第一个未完成阶段，接着跑 |
| **网页 Agent UI** | 轮询/读 `pipeline[]` 渲染顶部 stepper；`awaiting_review` 的步骤显示"去审查"按钮，用户 check 后把该步置 `approved` |

---

## 6. 静态流水线契约（不进 project.json，单独定义/文档）

> 这部分对所有项目都一样，是"哪步吃什么、产什么"的 DAG。建议放一个静态 `pipeline.def.json` 或就写在文档里。

| 阶段 | 消费 | 产出 |
|------|------|------|
| transcribe | `audio.asr` | subtitles_words.json, speaker_mapping.json, sentences.txt |
| roughcut | sentences.txt, subtitles_words.json | semantic_deep_analysis.json, review_roughcut.html →(用户)delete_segments_roughcut.json |
| fine | sentences.txt, (roughcut 导出) | fine_analysis.json, review_enhanced.html →(用户)delete_segments_edited.json |
| execute | delete_segments_edited.json, `audio.original` | 3_成品/*.mp3 |
| qa | 成品 mp3, delete_segments | qa 报告 |
| audio_quality | 成品 mp3, speaker_mapping | 音质处理版 mp3 |
| post | 音质处理版/成品 mp3 | 高光/片头/章节/标题/简介 |

> **Onboarding** 不在流水线里——它是 per-user 的前置条件。编排器/转录单元启动时检查 `用户偏好/<user>/` 是否存在且 `isConfigured`，否则先触发 onboarding。

---

## 7. 已敲定的决策（2026-05-25 冻结 v1）

1. **I/O**：project.json 只记 `outputs`（UI 要拿链接/审查页路径），`inputs` 不写进来，交给 §6 静态契约；上游产物用 `inputs_from` 引用。
2. **可选步骤默认值**：质检/音质/后期默认 `pending`，是否自动跑/跳过由 `preferences.yaml` 的 `workflow_automation` 决定（自动跳过时置 `skipped`）。
3. **多版本成品**：`execute.outputs.products` 用**数组**记 v1/v2/v3 重剪历史。
4. **审查导出命名**：粗剪导出 `delete_segments_roughcut.json`、精剪导出 `delete_segments_edited.json`，**分开命名**避免撞名（执行单元默认吃精剪的 `delete_segments_edited.json`）。
5. **谁写 manifest**：阶段0 先让现有大技能在每阶段末尾追加写；拆分后各单元各写各的阶段（单元只动自己那段，天然不冲突）。
6. **schema 演进**：保留顶层 `schema_version`，加载时按版本迁移；旧项目缺字段时按默认值补。

> 契约 v1 冻结。后续如需改字段，升 `schema_version` 并在此记录变更。

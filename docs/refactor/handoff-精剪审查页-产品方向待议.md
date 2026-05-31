# Handoff · 精剪审查页 — 产品方向待 @xiangge-li 跟 UI/UX partner 讨论

> 2026-05-30 evening。task #7 + task #8 一整天的 engineering 投入暴露了一个 product 层的根问题：**精剪审查页的目标到底是什么？** 这个问题不能由 engineering 决定，需要 partner 一起 think through。本文档把对话摘要 + 我们尝试过的路径 + 阻碍 + 候选方向都存下来，让 partner 来时能 cold start。

---

## TL;DR（三句话）

1. 我们今天追的"preview = cut byte-exact"是个**engineering 目标**，背后假设 = "用户必须逐刀确认 agent 每个删除决策"。
2. @xiangge-li 提出 reframing：他用别的剪辑工具时**不给逐刀 guidance**，听完成品给批次反馈就够了。如果这是真目标，**审查页可能根本不需要 preview = cut**——只需要"能查、能 undo、能听个大概"。
3. 现在卡在 product-strategy 层（要不要审查页 / 它的功能边界）。等 @xiangge-li 的 UI/UX partner 来一起讨论。

---

## @xiangge-li 的原话（2026-05-30 21:23）

> 我觉得最终我们要达到的目标其实是帮助用户去掉冗余的语气词，这是我们的核心目标。
>
> 其实精剪后的试听并不是必须的。就像我之前用"剪辑师"的时候，它会自动帮我先处理一遍，我不太需要给她 guidance。等它处理完，我直接听剪完的版本，然后再给一版反馈，让她进行一些微调。不过大体上，对于精剪语气词这一块，我不会给太多的反馈。
>
> 现在之所以加了这个"精剪确认页面"，主要的原因：担心 Agent 的判断不够成熟，剪掉的语气词可能不够精准。所以加一道人工关卡让大家去确认，确认的同时也可以试听。
>
> 关于具体怎么设计，我还没想好。但我觉得最终当 Agent 足够强的时候，可能是不太需要这个"精简逐字稿确认页面"的。

---

## 现在审查页的 ground truth

`剪播客/templates/review.html`：v7 统一模板，粗剪+精剪两态共用。
- 核心功能：渲染逐字稿、标记 agent 删除决策（句级 / 词级 / 半句级）、用户可 toggle 每条决策、点导出生成 `delete_segments_edited.json`
- preview 播放：audio element 播 `audio_seekable.mp3`（CBR 192k MP3），JS 监听 `timeupdate` 在删除段做 seek-skip
- export：`doExport()` 把所有 active 删除区间合成 JSON → 用户跑 `cut_audio.py` 出片

设计意图：**用户校对每条 agent 删除决策**。preview 想反映"删除生效后的听感"。

---

## 今天 engineering 路径（按时间线）

### Path 1: task #7 修 preview ≠ cut 漂移
PR #18 → PR #24 一系列尝试：
- **F1**（merged）：模拟 `trim_silences.py` post-pass。preview 里建模 ≥0.8s 静音裁短。✅ 节奏对齐
- **+30ms 自适应**（merged）：seek 后的"防 deleted onset 透"offset 自适应，不吃 next kept 词
- **applyBoundaryNudge fix**（merged）：tight-gap 不再 unconditional 拉 100ms，绝不吃 prev kept 词
- **F3 对称 fade 40ms**（revert）：preview seek 加 40ms fade-out + 40ms fade-in。引入耳机泄漏（OS audio buffer drain 不完整）
- **pause + drain 80ms**（revert）：fix 耳机泄漏。引入 'pause' 事件让 `pl=false` → 卡播放
- **wasPlaying 修正**（revert）：fix 卡播放。**但耳机泄漏没真消失**——OS buffer 物理限制
- **最终 C revert**（merged）：撤掉 F3/drain/pause 整条线，回到"简单 verify-seek + 短 fade-in"

### Path 2: task #8 A1 chunk-preview
试图彻底解决：generate 时预切 ~700 mp3/aac chunks，HTML 用 MediaSource 顺序 stream。
- **MP3 chunks**（fail）：byte-concat 时每 chunk 加 ~55ms encoder padding → 666 chunks 累积 36s drift
- **Opus webm chunks**（fail）：EBML container byte-concat 不工作
- **fMP4 + HLS**（partial）：byte-concat byte-exact ✅，但 HLS 不接受任意 cut points，AAC 没 keyframe concept，force_key_frames 对 audio 无效
- **fMP4 单 m4s = 完整 mp4**（fail）：ffmpeg segment muxer 产出独立 ftyp+moov 文件
- 总结：browser-side 真要 byte-exact toggle 响应，要么 ffmpeg.wasm（30MB + 慢），要么搭 localhost server

### Path 3: A.5（PR #25，未 merge，待决定）
妥协：HTML 加 🎧 cut 按钮。点击 → 切到预生成的 `preview_cut.mp3`（generate 时跑 cut_audio.py 出的），线性播放、关 JS skip。
- ✅ 按钮按下后 byte-exact 跟 cut_audio.py 输出一致
- ❌ 不反映 toggle（cut 是 generate 时基于 default state 跑的）
- 价值：省"切终端跑 cut_audio.py"那步，仅此而已

---

## 物理墙：为什么"preview = cut byte-exact"在 browser 里做不到

| 维度 | cut_audio.py（offline） | HTML5 `<audio>`（realtime） |
|---|---|---|
| 时间精度 | sample-级（~0.02ms @ 44.1kHz） | MP3 frame-级（~26ms） |
| 控制粒度 | 任意 sample | currentTime/volume 在 调度边界生效 |
| Buffer | 无（纯函数） | browser decoder buffer + OS mixer buffer，无法直接 flush |
| 静默 | `volume=0` 即时 | `volume=0` 后 OS buffer 还播几 ms 旧样本（耳机能听见） |
| 跨段过渡 | afade sample-accurate | JS 编排 setTimeout + seeked，不准 |

任何 JS-skip 补偿（fade、pause、drain）都是给"frame-级 buffered"补"sample-级 offline"的语义鸿沟。**每补一层引一层新副作用**。这条物理墙翻不过去（除非用 ffmpeg.wasm 在 browser 里跑 cut_audio.py 等效，工程量天大）。

---

## 候选 product 方向（讨论用，不锁死）

### A. 收掉审查页 preview，纯听 cut 输出
- 用户工作流：cut_audio.py 跑完 → 直接听成品（ffplay / iTunes / 现成播放器）
- 反馈：用户记 timestamp + "感觉" → agent feedback loop 学
- 审查页本身可以更轻量（甚至砍掉），把工程力气全押在**agent 精度**

### B. 保留审查页但 reframe 用途
- 用途不再是"逐条确认" → 是"按需 undo + 高层反馈"
- 默认不试听（避免 preview ≠ cut 期待）
- 提供"一键听 cut（默认状态）"和"export + 跑 cut + 听"（如 PR #25 的方向）
- 加 batch reasoning UI：agent 告诉用户它的 "策略"，用户给"策略反馈"而不是逐条 toggle

### C. 现状保留 + 接受 approximate preview
- 审查页留着、preview 留着（带已知 approximate 限制）
- 不投资修"preview = cut"
- 投资改 agent 精度（更少假阳性 = 更少需要人工 toggle）

### D. 长期：agent 强到不需要审查页
- 这是 @xiangge-li 的最终愿景
- LLM 精剪 prompt + 规则做到 95%+ precision
- 用户直接听成品

A/B/C 是过渡态，D 是终态。

---

## 给 partner 的具体问题

1. **审查页的 primary job 是什么**？信任 / 控制 / 校对 / 学习用户偏好 / 还是别的？
2. **用户实际工作流是什么**？开几次审查页、改多少、还是 review 一次就 export？
3. **如果保留审查页，preview 还需要吗**？
4. **如果 preview 是 nice-to-have，approximate 体验能接受到什么程度**？
5. **跟 D 方向（agent 自动出片）冲突的元素能不能砍掉**？

---

## 暂停 / 收掉的 engineering 状态

| 项 | 状态 | 建议 |
|---|---|---|
| PR #25 (A.5 cut 按钮) | 未 merge | 等 product 方向定再说 |
| task #8（A1 chunk-preview） | 调研 + 多个 prototype 卡在物理墙 | **建议关闭 / 转 long-term backlog** |
| task #2（咳嗽自动剪） | 检测脚本写了一半 | 跟 D 方向对得上，可以恢复做 |
| task #6 / #5 / #4 / #3 已合 | merged | — |

---

## 关键文件

- `剪播客/templates/review.html` —— 审查页统一模板
- `剪播客/scripts/cut_audio.py` —— offline cut（sample-level，真理）
- `剪播客/scripts/trim_silences.py` —— post-cut 长静音裁短
- `剪播客/scripts/generate_review.js` —— 生成 HTML + （PR #25 之后）自动跑 cut_audio.py 出 preview_cut.mp3
- `docs/refactor/handoff-preview-cut-wysiwyg.md` —— 今天 Plan subagent 的详细诊断（F1-F5 修复方案、severity 排序、validation 策略）
- `docs/refactor/handoff-a1-chunk-preview.md` —— task #8 A1 调研报告（mp3 chunks vs fMP4 vs ffmpeg.wasm 对比）

---

## 写完手册的人

@podcast-editor-agent（2026-05-30 21:35 EDT）

## 读这份手册的人

@xiangge-li 的 UI/UX partner（when 你回来）

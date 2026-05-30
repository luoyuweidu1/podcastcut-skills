# Handoff · 预览 / 成品 WYSIWYG 漂移诊断（task #7）

> Plan subagent 2026-05-29 调研报告。用户报告：网页预览跟实际 cut 出来的不一致。结论是**多个原因叠加**，主因不在最初列的 7 个怀疑里。

---

## TL;DR（三句话）

1. **主因发现**：`trim_silences.py` 在 `cut_audio.py` 之后**无条件**跑一次，把每个 >0.8s 静音裁到 0.6s。预览引擎完全没建模这一步，导致节奏漂移。
2. 次要原因有 5 个（说话人音量补偿、fade ramp 不对称、源音频差异、applyBoundaryNudge 不对称、MP3 帧 seek 抖动），按可听差异从大到小排。
3. 建议修复顺序：**F1（预览里建模 trim_silences）→ F3（对称 fade）→ F2（说话人音量）→ F4/F5 后议**。

---

## 1. 已确认的根因

### C1. `trim_silences.py` post-pass 预览不建模（新——最高 severity）

- `执行/SKILL.md:72-77` — execute step 2 无条件跑 `python3 trim_silences.py "$OUT"`，产物 `*_trimmed.mp3` 是用户实际听的文件。
- `剪播客/scripts/trim_silences.py:36-91` — 在已 cut 的文件上检测 >0.8s 静音并裁到 0.6s（`--target 0.6` 默认）。
- `剪播客/templates/review.html` `buildMergedRanges()` (line 999) + `skipIfNeeded()` (line 1043) —— 都不知道这一步。
- **结果**：每个 ≥0.8s 停顿成品里短 200-1400ms，预览全长。一期几十个点 → 用户听到节奏漂移。

### C2. `applyBoundaryNudge` 不对称是 explicit design

- `剪播客/templates/review.html:951-955` "陷阱 6" + line 1332-1334 (`doExport`)：doExport **故意不调** boundary nudge。
- preview 把非静音 skip range 起点往前拉 50-100ms（line 992-994）；cut 不拉。
- **结果**：每个 cut 点 preview 多吃 50-100ms 内容。

### C3. MP3 帧 seek + timeupdate 抖动（已大幅补偿）

- 物理限制：26ms MP3 帧 + ~250ms timeupdate 周期。
- 缓解栈：lookahead（line 1023-1111）+ `scheduleNextSkip()` setTimeout 预排程 + mute→seek→fade 已经很复杂。
- 残留：seek 落在 MP3 帧边界 ±~13ms + mute→seek→fade-in 插入 ~50ms 低音量窗口，cut 没有。听感：preview 略"碎"，cut 顺滑。

### C4. 源码 mismatch（hypothesis 1+7 都确认）

- preview 源：`1_转录/audio_seekable.mp3`（CBR 192k MP3 32kHz mono）
- cut 源：`1_转录/audio_original.m4a`（AAC 126k 32kHz mono）
- 两个都是 upstream 音频重编码版。AAC 和 MP3 perceptual 模型不同（MDCT block 大小、pre-echo、masking 曲线）。
- **结果**：即使不 cut，两个文件听感就有微差。cut 边界附近差异更大。

### C5. cut 加 fade ramp，preview 没加（hypothesis 5 确认）

- `剪播客/scripts/cut_audio.py:29-46` `calc_fade_duration()` —— 每个保留段最多 40ms fade-in/fade-out，afade ffmpeg 滤镜应用在 WAV 上。
- `剪播客/templates/review.html:1067-1088` —— preview 用阶梯式音量恢复（0→0.15→0.4→0.7→1.0 over ~50ms）**只在 skip 之后**。kept 段结尾没有 fade-out。
- **结果**：每个 cut 点 cut 文件有 80ms 对称 cross-fade，preview 只有 50ms 单向 ramp-up。kept 段尾声 preview 全音量、cut 衰减。累积差异跨 ~790 edits。

---

## 2. 已 refute 的怀疑

### Hypothesis 6 (edit-mode vs preview-mode separate skip logic) —— REFUTED

`剪播客/templates/review.html:1311` 的 `timeupdate` handler **无条件**调 `skipIfNeeded()`。`previewMode` 只改 UI（虚拟时间显示、侧栏、进度条分母 line 1278-1299）。skip 引擎统一。两个 MODE 但同一条 skip 路径。

### Hypothesis 3 (timeupdate latency) —— 部分 refute

`scheduleNextSkip()` (line 1097) 用 `setTimeout((s-t)/rate - la, ...)` 预排程，不靠 timeupdate fire skip。残留抖动是 setTimeout 最小 quantum (~4ms) + MP3 帧 snap 决定。已经在 `handoff-ui-playback-precision.md` line 184 实证。

---

## 3. 额外发现（7 之外）

### A1. trim_silences post-pass —— 已作为 C1 主因覆盖

### A2. 录前噪声延伸到 0 —— 对称行为 ✅

preview line 1013 + cut_audio.py line 288 都在第一个 delete range start < 5s 时自动扩展到 0。**对称，非 bug**。

### A3. doExport 没把最后一段 clamp 到 total_duration

cut_audio.py line 287-288 加 trailing keep `(last_end, total_duration)`。preview 的 `originalToVirtual()` (line 1223) 用 `S[last].e`。如果 total_duration > S[last].e（末尾 silence/applause），preview 认为结束更早。**结尾 <2s 差异**，minor。

### A4. AAC encoder priming delay（latent）

cut_audio.py line 462-468 输出 `.m4a` 时 AAC 加 ~2112 sample priming delay。当前默认输出 `.mp3` 不触发；切到 m4a 输出（PR #21）后会成问题。

### A5. 说话人音量补偿只在 cut（minor 不要小看）

`cut_audio.py:104-175` 跑 `calc_volume_compensation` + 应用最多 +6dB 给低响度说话人。**preview 没有**。多人对话且响度差 > 0.5dB 时：**cut 比 preview 响 / 平衡**。

---

## 4. Severity 排序（可听差异从大到小）

1. **C1**（trim_silences post-pass）—— 200-1400ms × 几十个长停顿。主因。
2. **A5**（说话人音量补偿）—— 至多 6dB 不平衡。多人对话明显。
3. **C5**（fade ramp 差异）—— ~30-80ms envelope × ~790 edits。累积"preview 碎"感。
4. **C4**（codec 源差异）—— everywhere but 192k MP3 vs 126k AAC at 32kHz mono 多数人难辨。
5. **C2**（applyBoundaryNudge 不对称）—— 50-100ms × 每个非静音 skip。
6. **C3**（MP3 frame jitter + mute window）—— ~50ms 音量凹陷 + ~13ms 抖动。已补偿，残留小。

---

## 5. 修复方案

### F1 —— 预览里建模 trim_silences（关闭 C1）

- **方向**：preview 改去匹配 cut
- **位置**：`剪播客/templates/review.html` `buildMergedRanges()` + `getSkipRanges()` + `originalToVirtual()` + `computeStats()`
- **方法（推荐 cheap path）**：generate-time 跑一次 ffmpeg silencedetect 在 `audio_original.*` 上，把 SILENCES_DETECTED 数组（start, end, duration）注入模板。preview 对每个 kept span 内 silence > 0.8s 合成 `[silence.start + 0.3, silence.end - 0.3]` pseudo-skip。**这正是 trim_silences.py 做的事，预测性地做一遍**。
- **代价**：generate 时多一次 ffmpeg 调用（~5s for 2hr 期）。preview 多 100-300 silence pseudo-skip-range。

### F2 —— 预览里加说话人音量补偿（关闭 A5）

- **方向**：preview → cut
- **位置**：`templates/review.html` audio element + `generate_review.js`
- **方法**：generate 时预算 per-speaker gain（复用 `cut_audio.py` 的 `calc_volume_compensation` 逻辑写 JS 版，或让 generate_review 调 `detect_speaker_loudness`）。注入 `SPEAKER_GAIN_DB = {...}` 到模板。用 per-sentence `au.volume` 调整（Web Audio GainNode 被 file:// CORS 卡死 trap 9）。
- **注意**：per-sentence 音量跳变会引入新微跳；100ms ramp smooth。
- **可选 gating**：放个 toggle，user 可以 A/B。

### F3 —— preview 加对称 fade envelope（关闭 C5）

- **方向**：preview → cut
- **位置**：`templates/review.html:1043-1088` `skipIfNeeded`
- **方法**：skip 前 30-40ms 把 `au.volume` ramp down（匹配 `calc_fade_duration`），seek，对面再 ramp up 30-40ms。用 cut_audio.py 同一 linear afade 曲线。丢掉当前阶梯式 restore (line 1077-1081)。

### F4 —— `applyBoundaryNudge` 对称（关闭 C2）

- **方向**：共用代码路径最干净
- **位置**：`templates/review.html:979-996` + `doExport()` (1322)
- **Option A**：`buildMergedRanges` 加 `{nudge: bool}` flag。preview 和 doExport 都传 `false`。onset pullback 责任完全交给 upstream `merge_llm_fine.js` + `refine_fine_analysis.js`。
- **Option B**：preview 留 nudge，doExport 加同一 nudge。**违反 line 955 design comment**，但 WYSIWYG 最紧。
- **Tradeoff**：A 风险是"preview 不再前移，未精修过的点重新有残音"；B 是"export 紧了，某些 kept 词的辅音前段被吃 50-100ms"。

### F5 —— 统一源音频（关闭 C4）

- 简单：cut_audio.py 指向 `audio_seekable.mp3`。但**回退**了"高质量源"决策。
- 更好：重生 `audio_seekable.mp3` from `audio_original.m4a` with **identical encoder params**——已经是 `转录/SKILL.md:61` 在做。接受 AAC→MP3 转码损失，认为是 wash。
- 最佳（长远）：`generate_review.js` 调 `cut_audio.py --dry-run` 生成 preview-targeted virtual concat WAV，作为 preview audio。preview = cut byte-for-byte。代价：~700MB / 2hr 期。

---

## 6. Tradeoffs & constraints

- **F1**：必须在 cut-side 逻辑信号上跑 silencedetect，不是源音频——因为两个删除附近的两段短静音 cut 后会融成一段大静音。implementation 要么先合成 concat-WAV 跑，要么扫原音频+模型删除列表后合并。non-trivial。
- **F2**：per-sentence 音量跳变会让长 monologue 抖；100ms ramp smooth。检测"当前播放哪个说话人"要 cheap（预先建 time→speaker map）。
- **F3**：preview 更 faded → 每个 cut 点听感更"闷"。A/B 时反而短期"不像 WYSIWYG"直到耳朵适应。validate against meeting_02。
- **F4**：line 953-955 design 明示"doExport 保持 raw"，B 违反。A 只在 upstream pullback 覆盖率 ≥95% FE entries 安全。`handoff-fine-analysis-recall.md` line 186 说 5/9 user 报告残音根本没 FE entry——upstream 覆盖不完整。**A 风险回归用户可见残音**。
- **F5**：`refine_fine_analysis.js:45-56` 文档明示 `audio_seekable.mp3` 是 refine 的 fallback 因为重压缩"平滑能量包络"——refine 偏好 `audio_original.m4a` 的波形精度。强迫 cut 用 MP3 会**回退 refine 边界精度**。

**Invariant to preserve**：`cut_audio.py` 必须保持仅由 `delete_segments_edited.json` 重现（无 preview state）。**所有 preview fix 不准把 preview-only state 偷渡进 export JSON**。

---

## 7. 推荐 ship 顺序

1. **F1 先**：解 dominant cause，self-contained preview 改动，无风险给 cut 路径或 export 格式。一次 ffmpeg + ~50 行 JS。
2. **F3 第二**：对称 fade 小、contained，提感知 smoothness，单位 edit envelope 与 cut 对齐。无数据格式改动。
3. **F2 第三**（toggle gated）：说话人音量补偿对用户最 surprising，off-by-default。
4. **F4 debate**——A 但等 upstream pullback 覆盖 ≥95% FE。`handoff-fine-analysis-recall.md` 工作完才动。否则保留 preview-only nudge。
5. **F5 推迟**。F1+F3 落地后再 A/B；只有还残留 codec-attributable 差异才动。

---

## 8. 验证策略

对每个 fix 在 `meeting_02` 上验证：

1. **端到端 A/B**：浏览器开 `review_enhanced.html` preview 模式 10 个已知 timestamp 试听；同时 `ffplay -ss <对应虚拟时间> ...trimmed.mp3` 对比。耳判。`handoff-ui-playback-precision.md` 已定 protocol。
2. **F1 specific**：`ffmpeg silencedetect -af silencedetect=noise=-30dB:d=0.8` 找 `meeting_02_精剪版_v5_fade40_192k.mp3`（pre-trim）的 top-10 长静音。preview 是否在同一 ~600ms 压缩窗口内跳过。具体 log `getSkipRanges()` 输出 diff `trim_silences.py` 的 `keep_segments`。
3. **F3 specific**：OS 音频抓 preview 10 个 cut 点，cross-correlation 跟 cut 文件对应 sample range 比。target：cut 边界 envelope peak ±5ms 对齐。
4. **F2 specific**：preview vs cut 10 个 per-speaker sentence-level segment 测 LUFS-S。target：max LUFS-S delta < 1.0dB。
5. **F4 specific**：preview nudge 改后，重生 `delete_segments_edited.json`，跑 cut_audio.py，sample-level RMS diff 跟前一版 cut 比。target：no kept-word onset loss > 30ms。
6. **Regression**：跑 `handoff-ui-playback-precision.md` 上 meeting_02 9-point 用户报告，无回归。

---

## Critical Files for Implementation

- `剪播客/templates/review.html` line 951-1111, 1286-1359 —— `buildMergedRanges`, `skipIfNeeded`, `scheduleNextSkip`, `doExport`, `timeupdate`
- `剪播客/scripts/trim_silences.py` line 36-91 —— silence 检测逻辑（F1 要在 preview 里 mirror）
- `剪播客/scripts/cut_audio.py` line 29-46 fade, 104-175 说话人音量 —— preview parity 参考
- `剪播客/scripts/generate_review.js` line 33 audio src, 220-282 FE 注入 —— 加 SILENCES_DETECTED + SPEAKER_GAIN_DB 注入点
- `执行/SKILL.md` line 47-95 —— 验证 pipeline order（cut → trim_silences），F1 的行为目标

---

写完手册的人：Plan subagent（2026-05-29 调研，约 4 分钟）
读这份手册的人：下一个 implementation session（task #7 落地）

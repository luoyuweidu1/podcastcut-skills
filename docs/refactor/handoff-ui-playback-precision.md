# Handoff · 修 UI 预览精度(残音问题)

> 下次 session 接续。任务:统一模板的精剪审查页"看上去删了但听得见"——A/B 实测确认主因是**浏览器物理限制**,不是数据 bug。修法是把旧 `review_enhanced.html` 的陷阱 6 那套精度补偿移植过来。

---

## TL;DR(三句话)

1. **现象**:用户在 meeting_02 精剪页报告 9 处"UI 显示已删但能听到"。
2. **A/B 实测**:同一时间点听**成品 mp3** 干净(尤其 S17 那个"对"在成品里没有残留),但 UI 预览有——说明 UI ≠ 成品。
3. **修法**:绝大多数残音是 UI 浏览器物理限制(MP3 seek 帧级 + JS 定时延迟),修在模板的播放跳过逻辑;另有 1 处**成品也听得到**(用户记笔记中),是数据层 bug,反查 fine_analysis 修边界。

---

## 用户报告的 9 处(原始记录)

| # | 句号 | 用户描述 | 我的初判类别 |
|---|------|----------|--------------|
| 1 | S8 | "很久很久" 删第一个"很久"后还是有残音 | A. 边界外扩不足(陷阱 25) |
| 2 | S15 | "对"在 UI 上已删但仍听到,似乎残留在 S14 末尾 | B. ASR 跨句错位(陷阱 28) |
| 3 | S17 | 句首"对"已删但听到,点 S17 又没了 → 残留在 S16 末 | B. ASR 跨句错位 |
| 4 | S17 | "对/呃/多一点"都显示删了但听得到 | A+B 混合 |
| 5 | S18 | 句首"啊"已删但有爆破停顿感 | A. filler pre-onset 没 pullback(陷阱 26/39) |
| 6 | S19 | "啊上海大学的老师"的"啊"剪不干净 | 同 #5 |
| 7 | S20 | 整句已删但听得到 | C. UI 跳过精度(陷阱 6)或 endTime 错 |
| 8 | S23 | "比较比较有点有点这个 old" 的重复词已删但听到 | A. 极端重复 ASR 分词 |
| 9 | S25 | "呃" 已删但听到 | A. 同 #5 |

**收敛成三类根因**:
- **A 边界外扩不足** — 删除范围必须吃掉前后词的间隙(filler 尤其要 ~100ms pre-onset pullback)
- **B ASR 跨句错位** — 数据上属于句 N 但音频实际跨在 N-1/N 边界
- **C UI 浏览器跳过精度** — MP3 seek 帧级 + JS 定时延迟,跟 cut_audio.py 的 PCM 样本级切不是一回事

---

## A/B 实测(用户做的,关键证据)

用户听了成品 `3_成品/meeting_02_精剪版_v1_trimmed.mp3`:
- **S17 那个"对"残留在成品里没有** — 证明 UI 预览有,但实际切片没。**UI 和成品精度差距是真实的。**
- 但**成品中间有一处**确实有残留(用户记笔记中,待补充:时间 + 听感 + 旁边几个字)

**这就改变了任务优先级**:把 9 处的绝大多数归到"UI 浏览器物理限制"类(C 类),用 UI 跳过补偿一把搞定 80%;A/B 类只需要修那个**成品也听到的**单点。

---

## 根因(物理层)

### 成品 cut_audio.py 为什么干净
- 先 `ffmpeg -ss 在 -i 之前` 解码为 WAV(陷阱 10/11)
- 在 WAV PCM 样本上切,**精度 ~0.02ms @ 44.1k**
- 3ms 微 fade 防爆破(`--no-fade` 模式)
- 切完 concat → 重编码 MP3
- 边界由 `delete_segments_edited.json` 的 `start/end` 决定 —— 这两个值已经经过 merge_llm_fine.js 的边界外扩 + refine_fine_analysis.js 的波形 onset 精修

### UI `<audio>` MP3 为什么残音
- MP3 帧约 26ms,`audio.currentTime = t` 只能 seek 到最近帧边界
- JS `timeupdate` 事件触发频率 ~4-66Hz,通常 ~250ms 间隔
- 浏览器音频解码器有缓冲,**已塞进喇叭的样本无法撤回**
- 当 `if (t >= f.s && t < f.e) au.currentTime = f.e+.02` 触发时,真实播放头已经往后跑了几十 ms,部分待删内容已发声
- 这是浏览器物理限制,**不可能通过"算更精确的 deleteStart"解决**,必须用补偿策略

---

## 修复路径

### Task 1(主要)· 移植陷阱 6 的 UI 跳过补偿到统一模板

旧 `review_enhanced.html`(已删,git log 可见)的 `getSkipRanges()` 用了一套"分层补偿":

**6a 自适应 lookahead** — 每个 skip range 根据前一个保留词的 end 算安全提前量:
```js
const gap = rangeStart - closestPrevWordEnd;
range[2] = Math.min(0.30, Math.max(0.05, gap));  // 句间 gap 大→300ms; 句内 gap 小→50ms
```

**6b 紧密间隙 range 前移**(分层缓冲) — 删除紧挨保留词时把 range 起点前推,防 onset 泄漏:
```js
if (gap < 0.02)       merged[i][0] -= 0.10;  // 零间隙(词边界): 前移 100ms 防声母泄露
else if (gap < 0.10)  merged[i][0] -= 0.05;  // 窄间隙: 前移 50ms
```

**6c mute → seek → fast-restore** — 用 volume=0 而不是 muted/pause:
```js
audio.volume = 0;
audio.currentTime = seekTarget;
audio.addEventListener('seeked', ()=>{
  audio.volume = savedVol * 0.3;                          // 30% 起步
  setTimeout(()=>audio.volume = savedVol, 20);            // 20ms fade-in 防 click
}, { once: true });
setTimeout(resume, 80);                                   // 80ms fallback,防 seeked 不触发
```

**6d seekTarget 精确落点** — `seekTarget = e`(删除范围精确结束点,**不加偏移**);仅当 `nextKept.startTime <= e + 0.5` 时才用 nextKept(避免精剪 seekTarget 跳过整句,陷阱 5)。

#### 当前统一模板的播放跳过(简陋版)
位置:`剪播客/templates/review_roughcut.html`,第 ~1126-1135 行附近的 `timeupdate` 监听器:
```js
if(pl)for(const x of S)if(del.has(x.idx)&&t>=x.s&&t<x.e){au.currentTime=x.e+.05;return}
if(pl){
  for(const k in pdel){ ...if(t>=r.s&&t<r.e){au.currentTime=r.e+.02;return} }
  for(const f of FE){ ...if(t>=f.s&&t<f.e){au.currentTime=f.e+.02;return} }
}
```
没有 lookahead、没有 mute 防 click、没有紧密间隙前移。**这是大头要改的地方**。

#### 实施步骤(建议)
1. 在 doExport 之外加一个 `getSkipRanges(opts)` 函数,统一构造时把 lookahead/前移算好。
2. timeupdate 改为查 `getSkipRanges()` 的 `[start, end, lookahead]` 三元组(原算法)。
3. 跳过动作改为 `volume=0 → currentTime=e → seeked: volume restore 20ms`。
4. 旧版导出有"陷阱 8: 导出剪辑文件不能用播放器 skip ranges"——意思是 doExport 必须用**干净的**合并范围(无 nudge/lookahead),所以两套要分开:**预览用 nudged ranges,导出用干净 ranges**。

### Task 2(次要)· 反查那一处成品也听到的残留

等用户给出:**成品时间 + 听感 + 旁边几个字**(用户在补)。

流程:
1. 用 ffplay 跳到那个时间:`ffplay -ss <时间> "$B/3_成品/meeting_02_精剪版_v1_trimmed.mp3"`
2. 反查 `delete_segments_edited.json` 中那个时间段对应哪个 segment
3. 反查到 `fine_analysis.json` 找到原始 edit:
   ```js
   const t = <用户给的时间>;
   r.edits.filter(e => Math.abs(e.deleteStart - t) < 2).forEach(e => console.log(e));
   ```
4. 看是:
   - 边界外扩不够(陷阱 25/26/39):修在 `merge_llm_fine.js` 的 boundary extension 段
   - ASR 跨句错位(陷阱 28):需要在生成 FE 时把跨边界的 onset/coda 包进来
   - refine 漏精修(陷阱 35/36/38):看 `refine_fine_analysis.js` 那条 edit 是否被跳过(low confidence?)

---

## 关键文件 + 行号

| 文件 | 关注什么 |
|------|----------|
| `剪播客/templates/review_roughcut.html` | timeupdate 监听器(~1126);doExport(~1131);新加 `getSkipRanges` |
| `剪播客/scripts/generate_review_roughcut.js` | FE 时间计算(`s/e` 来源);silence 类时间(time-only) |
| `剪播客/scripts/merge_llm_fine.js` | boundary extension(陷阱 25/26/39 应该在这);post-merge gap cleanup |
| `剪播客/scripts/refine_fine_analysis.js` | onset 精修;`_refinePoints` 标记;confidence < 0.5 fallback |
| `剪播客/参考/技术陷阱与波形.md` | **必读**:陷阱 6/8/25/26/28/35-40 全在这 |
| `剪播客/scripts/cut_audio.py` | 不需要改(成品已经干净),但要看 `-ss` 位置和 fade 处理(陷阱 10/11/27) |

git log 里搜 `generate_review_enhanced.js` 能找到那 5000 行旧实现的最后一版,陷阱 6 的代码在那里头。

---

## 测试方法

A/B 测试(发现问题/验证修复都用):
1. 浏览器打开统一模板生成的 `review_enhanced.html`,听有问题的句子(播放跳过的位置)
2. 同步开 `ffplay -ss <对应时间> "$B/3_成品/meeting_02_精剪版_v1_trimmed.mp3"`(成品)
3. 听是否一致

修复 UI 跳过后,**绝大多数 UI 残音应该消失**,A/B 听感对齐。剩下的就是真·数据 bug。

---

## 上下文(别忘)

- **当前分支** `refactor/phase0-manifest`,本地未推。改完 UI 跳过提交一个,改完数据层提交另一个,清晰分离。
- **meeting_02 项目数据完整在** `output/2026-05-25_meeting_02/`(转录/粗剪/精剪/成品/manifest 都齐),续跑就拿它做测试用例。
- **统一模板和生成器** 现在同时服务粗剪+精剪两阶段(2026-05 重构决定),改之前想想对粗剪页有没有影响——但 UI 跳过精度对粗剪页也是同问题,改对两边都受益。
- **架构原则**:陷阱 6 是浏览器物理限制的补偿,不是数据修正。**别把 lookahead/前移混进 deleteStart/deleteEnd**(那是数据维度,会泄漏到导出);只在 UI 跳过函数内部用。
- **方案 1 已落地**:粗剪→精剪 通过 `sentence_deletes/partial_deletes` 字段交接,这次修不要破坏这条线。

---

## 相关历史

- 旧 review_enhanced.html(已删,git: `883eb4b^`)实现了陷阱 6 的完整补偿。
- 统一模板移植时(2026-05)我**只移植了简陋版的"看到就跳"**,陷阱 6 那套没移植——这是债务,这次还。
- meeting_02 出片时用户因浏览器缓存看到的也是旧 review_enhanced.html,所以那次他没遇到 UI 残音问题;新统一模板没这层补偿,所以这次他踩到了。

---

写完手册的人:Claude(2026-05-26 18:xx)
读这份手册的人:下一个 session 的 Claude(可能是同一会话的延续或全新启动)

---

## 后记 · Task 1 已完成(2026-05-29)

陷阱 6 移植完成并 commit:`68a85f3` feat(精剪): 移植陷阱 6 UI 跳过补偿到统一模板。

- **Level 1 算法验证已跑** —— meeting_02 实数据:549 merged ranges,FE 覆盖 673/754,nudge 分层正确,lookahead ∈ [0.05, 0.30]。脚本 `/tmp/level1-skip-ranges-verify.js`(临时,可挪 `tools/` 持久化)。
- **偏离旧 enhanced 的决定**:applyBoundaryNudge 只进 preview,不进 doExport。当前 pipeline 上游已做 onset 补偿,成品被 A/B 实测为干净。
- **次级发现 → 新 handoff**:Level 1 暴露了一个比 UI 更重要的问题——**用户 9 处报告里 5 处(S8/S17/S20/S25/部分 S17)在 fine_analysis 根本没标 FE**。播放器修不了空集。详见 [`handoff-fine-analysis-recall.md`](handoff-fine-analysis-recall.md)。
- **Task 2(成品也听到的单点反查)** still pending —— 等用户给出时间 + 听感 + 旁边几个字。
- **Level 2/3 验证未做** —— 边际收益不足。如果实际听感还有问题,Level 2 再说。

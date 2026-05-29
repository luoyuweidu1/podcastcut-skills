# Handoff · 精剪 recall 漏标 (S8/S17/S20/S25 没生成 FE)

> 上一份 handoff(`handoff-ui-playback-precision.md`)的 Task 1(UI 跳过补偿)已完成并 commit。Level 1 算法验证暴露了**真正的主线问题**:**用户报告的 9 处 UI 残音里,4 处在 fine_analysis 根本没标 FE**——不是播放精度,是分析层 recall 不足。这份 handoff 接力 Task 2。

---

## TL;DR(三句话)

1. meeting_02 用户报的 9 处 UI 残音中,**S8 / S17 / S20 / S25 这 4 处的句子在 fine_analysis.json 里 0 条 FE**。
2. 这 4 句都是用户描述里有明确删除诉求的(整句重复 / 句首"对"等),LLM/规则层没标到 = recall 漏。
3. 修法:反查 `run_fine_analysis.js` 的 prompt / 规则,看为什么这些句被跳过。可能是 prompt 偏 precision、句长过滤、speaker 漏 或 句子被划入低优先级 chunk。

---

## 上一份 handoff 的状态(确认 closed)

`docs/refactor/handoff-ui-playback-precision.md` 的 Task 1(UI 跳过补偿)已完成:

- [x] 陷阱 6 完整移植(6a 自适应 lookahead / 6b 紧密间隙前移 / 6c mute-seek-fade / 6d 精确落点 + 跨 range 兜底)→ commit `68a85f3`
- [x] Level 1 算法验证通过(脚本 `/tmp/level1-skip-ranges-verify.js`,可重跑)
- [ ] **Level 2/3 跳过** —— 性价比低,留给后续如果还能听到残音再回来

未做的事:**handoff-ui-playback-precision.md 的 Task 2**(反查那 1 处成品也听到的残留)—— 等用户给出时间 + 听感 + 旁边几个字后单点修。

---

## 新发现 · Level 1 验证的副产物

跑算法对实数据 → 把用户 9 处报告分类:

| # | 句号 | 用户描述 | FE 状态 | 结论 |
|---|------|---------|---------|------|
| 1 | S8 | "很久很久" 删第一个"很久"后残音 | **FE=0** | **数据层漏标** |
| 2 | S15 | "对"残留在 S14 末 | FE=2 | UI 已覆盖 |
| 3 | S17 | 句首"对"已删但听到 | **FE=0** | **数据层漏标** |
| 4 | S17 | "对/呃/多一点"显示删了但听到 | **FE=0** | **数据层漏标** |
| 5 | S18 | 句首"啊"已删但有爆破停顿感 | FE=10(9 覆盖,1 个 40ms stutter 被过滤) | UI 已覆盖 / 边界仍可调 |
| 6 | S19 | "啊上海大学的老师" | FE=1 | UI 已覆盖 |
| 7 | S20 | 整句已删但听得到 | **FE=0** | **数据层漏标** |
| 8 | S23 | "比较比较有点有点这个" | FE=2 | UI 已覆盖 |
| 9 | S25 | "呃"已删但听到 | **FE=0** | **数据层漏标** |

**5/9 是 FE=0**。播放器再怎么精确也没用——这些句子上游根本没标 filler edits。

---

## 反查路径

### 步骤 1:看这 5 句长什么样

```bash
BASE=output/2026-05-25_meeting_02/剪播客
for IDX in 8 17 20 25; do
  echo "=== S$IDX ==="
  jq ".[] | select(.idx == $IDX)" $BASE/2_分析/fine_analysis.json 2>/dev/null || echo "(不在 fine_analysis 顶层)"
  # 看句子内容
  jq -r ".[] | select(.idx == $IDX) | .t" $BASE/2_分析/semantic_deep_analysis.json 2>/dev/null
done
```

或者用 sentences.txt + 行号(idx 0-based → 行号 = idx+1)直接看。

### 步骤 2:看 LLM 输入是否包含这些句

`run_fine_analysis.js` 走的是分 chunk 喂给 LLM:

```bash
# 找 chunking 逻辑
grep -n "chunk\|window\|batch" 剪播客/scripts/run_fine_analysis.js | head -20
# 找 prompt
grep -n "prompt\|system\|你是\|你需要" 剪播客/scripts/run_fine_analysis.js | head -10
```

可能的漏标原因(按概率排序):

1. **prompt 偏 precision**:示例只给"卡顿/语病/无意义的'对'",LLM 学得保守 → 实际可疑的"对/呃"被放过
2. **chunk 边界丢上下文**:S8 出现在 chunk 第一句时,LLM 看不到前句,判断不出"很久很久"是重复
3. **句长过滤**:有的 LLM 步骤可能跳过过短句 → S25 "呃"如果是独立短句被略过
4. **rules-only 通道**:`fine_analysis_rules.json` 是规则层的产物;某些 filler 规则可能要求 speaker 标记到位
5. **后续 merge/refine 误删**:`merge_llm_fine.js` / `refine_fine_analysis.js` 可能对 confidence < 阈值的 edit 做过滤

### 步骤 3:三个文件对比

```bash
BASE=output/2026-05-25_meeting_02/剪播客/2_分析
for F in fine_analysis_rules fine_analysis_llm fine_analysis_pre_refine fine_analysis; do
  echo "=== $F.json ==="
  for IDX in 8 17 20 25; do
    jq "[.[] | select(.idx == $IDX)] | length" $BASE/$F.json 2>/dev/null | xargs -I{} echo "S$IDX: {} 条"
  done
done
```

这会告诉你这 4 句在 4 个阶段里**哪一步消失了**:
- rules → 没就是**规则没匹配**
- llm → 没就是 **prompt 没召回**
- pre_refine → 有但 refine 后没 → **refine 误删**
- final → 有但 review 页过滤了 → **生成器 bug**(less likely)

### 步骤 4:针对性修

修哪一步看步骤 3 的结果:
- 规则没匹配 → 看 `fine_analysis_rules.json` 是怎么生成的,加规则
- prompt 没召回 → 改 prompt(加正例 / 降保守度);可以拿这 4 句做 prompt eval 的 ground truth
- refine 误删 → 看 `refine_fine_analysis.js` 的过滤阈值

---

## 关键文件

| 文件 | 关注什么 |
|------|---------|
| `剪播客/scripts/run_fine_analysis.js` | LLM 调用 + prompt;chunking 逻辑;并发/重试 |
| `剪播客/scripts/merge_llm_fine.js` | LLM + 规则两路合并;过滤阈值;边界外扩 |
| `剪播客/scripts/refine_fine_analysis.js` | onset 精修;低 confidence 跳过;_refinePoints 标记 |
| `剪播客/参考/技术陷阱与波形.md` | 陷阱 25/26/35/36/38/39 涵盖 recall vs precision 的历次教训 |
| `output/.../2_分析/fine_analysis_{rules,llm,pre_refine,final}.json` | 4 个阶段产物,对比定位 |
| `output/.../剪播客/2_分析/sentences.txt` | 这 4 句的原文(看为什么 LLM 漏召回) |

---

## 已知约束(别破坏)

- **方案 1**(粗剪→精剪 通过 `sentence_deletes/partial_deletes` 字段交接)别破:fine_analysis 的 sentence_deletes 输入还是从 `delete_segments_roughcut.json` 来。
- **统一模板和生成器**(`generate_review.js`)别动:Task 1 刚改过 review_roughcut.html,改 prompt/规则不应该再影响模板。
- **doExport 没变** —— 不要因为 recall 增加而担心成品 — 多召回的 FE 会自然进 export 路径,cut_audio.py 在 PCM 样本级切,边界已经被上游精修。

---

## 验证(改完 prompt 之后)

1. 重跑 `run_fine_analysis.js` 对 meeting_02
2. 看 S8/S17/S20/S25 的 FE 是否被召回
3. 重生成 review_enhanced.html(命令在 `精剪/SKILL.md:108`)
4. 人耳听这 4 句

可以用 Level 1 验证脚本同样格式 dump 新旧 FE 对比,确认其他句子的 FE 没退化(precision 没掉)。

---

## 上下文(别忘)

- **当前分支** `refactor/phase0-manifest`
- **最新 commit** `68a85f3` (陷阱 6 UI 跳过补偿)
- **没合到 main**:这个分支系列(refactor/phase0-manifest)是为 web-agent UI 重构铺路,本地未推
- **meeting_02 项目** 数据完整在 `output/2026-05-25_meeting_02/`,做实验用例
- **架构原则**:这次的修是数据层(B/C 类),跟 Task 1(UI 物理补偿)正交。两条路径都该收敛 → 用户报的残音 = 上游 + 浏览器 两层都修干净

---

## 相关历史

- 这份 handoff 由 Task 1 完成后的 Level 1 验证副产物催生 —— 算法层验证脚本能跑出 FE 覆盖率,顺手就把"哪些句根本没标"暴露出来了
- 算法验证脚本路径:`/tmp/level1-skip-ranges-verify.js`(每次会丢,改进:挪到 `tools/` 或 `scripts/` 持久化)

---

写完手册的人:Claude(2026-05-29 深夜)
读这份手册的人:下一个 session 的 Claude(可能延续可能全新)

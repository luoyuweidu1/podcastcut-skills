# 播客剪辑 TODO

## 架构改进

- [ ] **精剪引入 LLM 二次确认**：当前精剪（Step 5b）纯 pattern matching，缺乏语义理解，导致数字（100→"0""0"）、特殊表达等误判。方案：pattern matching 先出候选，LLM 判断 true/false，保留精确时间戳定位能力。优先级：中。触发场景：新 podcast 出现新类型误判时。

## 已知未修复 Bug

- [ ] **陷阱18 — stutter toggle 阻塞**：切换 stutter 删除状态时可能阻塞 UI
- [ ] **陷阱19 — stutter cancel 仍显示删除样式**：取消 stutter 后视觉上仍然显示为删除
- [ ] **陷阱20 — 拼接伪影**：FFmpeg 剪切点可能产生音频伪影
- [ ] **陷阱21 — 未标记的删除**：部分删除操作没有在审查页显示标记

## 精剪规则待完善

- [ ] **句首单独填充词检测**：48/72 stutter missed catches 是句首 "嗯，"。当前 fine analysis 只检测连续相同词，不检测单独的句首填充词。规则已更新在 `2-填充词检测.md`，但 generate_fine_analysis.js 是每次会话内联生成的，需要在 SKILL.md 的 Step 5b prompt 里加入此规则。

# TODO / Backlog

未排期的改动账本——每条带"源自哪个迭代"和"为什么先不做"。新条目按时间倒序加在最上面。

---

## 源自 PR #18（Tier 2 onset + 导出/编码精修，2026-05-29）

### 1. 开头咳嗽自动剪
- **现象**：`meeting_02` 这期开头有一声咳嗽没被剪掉（用户报告 v5 试听）
- **怎么修**：粗剪规则层可以加一条 "前 10 秒内 / 整句开头独立非语言音（咳嗽/清嗓/吸气）自动标 delete"，可能要靠音频信号（瞬态能量峰 + 频谱特征）而不是 transcript
- **为什么不今天做**：需要一组带咳嗽的样本调阈值；用户当下表态"问题不大"——可以手动框选解决
- **关联文件**：`粗剪/SKILL.md`，可能新增 `剪播客/scripts/detect_episode_intro_noise.py`

### 2. m4a/AAC 直出
- **现象**：源音频是 AAC（如 `audio_original.m4a`），最终成品是 MP3——两次有损编码 + 不同 codec 家族转换损失高频细节
- **怎么修**：`cut_audio.py` 加 `--codec aac` 或 `--output-format m4a` 选项，输出时直接 `-c:a aac -b:a 256k` 不转 MP3；或根据输出文件后缀自动选编码
- **为什么不今天做**：PR #18 已经把 bitrate floor 拉到 192k 缓解了大部分听感问题；m4a 输出涉及决定是否改默认（兼容下游 trim_silences、音质处理）
- **关联文件**：`剪播客/scripts/cut_audio.py`、`剪播客/scripts/trim_silences.py`

### 3. silence_merged 不检查 keep 词跨越（陷阱级 latent bug）
- **现象**：`merge_llm_fine.js` 的 silence_merged 会把两个相邻 delete 之间的"静音"裁短到 0.8s，但**不检查这段间隙里是否有保留词**。如果间隙里其实是 keep 内容，会被一口吞掉
- **现状**：当前 doExport 容差 0.05s（PR #18）已经让大部分情况不会触发；但 silence_merged 自身的扩展是 fine_analysis 层的，理论上仍可能产生"看起来合理但实际跨保留词"的 segment
- **怎么修**：silence_merged 生成前扫一遍 `actualWords`，确保 [gap_start, gap_end] 内没有 keep 词。如果有，要么不合并，要么把 silence_merged 起止挪到 keep 词之外
- **为什么不今天做**：当前没有用户报告的 bug 触发，等再有具体 case 再补 fix
- **关联文件**：`剪播客/scripts/merge_llm_fine.js`（generateGapEdits 那段）、`notes/jingjian-bugs-2026-05-29.md`（@podcast-editor-agent 的诊断笔记）

### 4. 模板 `review_roughcut.html` → `review.html`
- **现象**：PR #18 把 `generate_review_roughcut.js` 改名成 `generate_review.js` 去阶段化，但配套模板 `templates/review_roughcut.html` 没改名（用户说"先不动模板"）
- **怎么修**：`git mv templates/review_roughcut.html templates/review.html`，同步更新 `generate_review.js` 里的 templateFile 路径 + 任何引用 `review_roughcut.html` 的 docs
- **为什么不今天做**：用户在 PR #18 这轮明确说"模板下次再说"
- **关联文件**：`剪播客/templates/`、`剪播客/scripts/generate_review.js`

### 5. refine_fine_analysis.js 现在依赖 audio_original.m4a
- **现象**：PR #18 把 refine 默认音频源改成 `audio_original.*`，回退到 `audio_seekable.mp3`。如果用户从 `audio_original` 不存在的旧项目重跑会回退（带 warning），但本地新项目应都有 original
- **怎么修 / 不修**：不是 bug，是约束。如果某个老项目重跑发现 onset 精度不如预期，要确认 `1_转录/audio_original.*` 是否仍在
- **关联文件**：`剪播客/scripts/refine_fine_analysis.js` line 42-66

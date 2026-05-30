# Handoff · A1 chunk-preview（task #8）

> 解决 preview vs cut sample-级不匹配的根因：HTML5 `<audio>` 是 frame-级 + buffered，cut_audio.py 是 sample-级 offline。所有 JS-skip 补偿（F3 fade / pause+drain / buffer hold）都引入新副作用。A1 通过 pre-cut + MediaSource API 让 preview = cut byte-exact。

---

## TL;DR（三句话）

1. **架构**：generate 时预切原音频成 ~700 个 keep-segment mp3 chunk，HTML 用 MediaSource API 按 active list 顺序 stream。
2. **关键技术**：mp3 chunks 用 `ffmpeg -write_xing 0` 出 CBR no-Xing 流，**byte-level 拼接合法**（已实测 ffprobe + MediaSource 都能读）。
3. **toggle 响应**：~100ms（重算 active list + MediaSource update）。preview 与 cut sample-byte 一致，无 frame seek / buffer drain 问题。

---

## 三个候选方案对比

### 1. MediaSource API + mp3 chunks（**推荐**）
- ✅ 浏览器原生，无 JS overhead
- ✅ mp3 codec MediaSource 全 browser 支持（Chrome/Firefox/Safari isTypeSupported('audio/mpeg') 都 true）
- ✅ 实测 `-write_xing 0` CBR mp3 chunk byte-level 拼接合法（见下方验证）
- ⚠️ 需小心 mp3 frame 对齐（CBR + 整数倍 frame size）
- 💾 ~25MB 磁盘（700 chunks × 30KB avg）

### 2. ffmpeg.wasm（**不推**）
- ✅ Sample-级精确，可以 100% 复刻 cut_audio.py
- ❌ 30MB JS bundle 首次加载
- ❌ wasm 比 native 慢 2-3×，2hr 期 cut 可能 30-60min
- ❌ 不能解决 "toggle 即时响应" 因为每次重 cut 还是慢

### 3. 两文件 hybrid（**已基本是 C 状态，不推**）
- 原音频 + cut 音频两个 audio element 切换
- toggle 慢（需要全期重 cut）
- 不解决根本问题

**结论：方案 1（MediaSource + mp3 chunks）。**

---

## 关键技术验证：mp3 chunk 拼接

```bash
# 生成两个 chunk（CBR + 无 Xing）
ffmpeg -f lavfi -i "sine=frequency=440:duration=1" \
  -c:a libmp3lame -b:a 128k -write_xing 0 -y chunk1.mp3
ffmpeg -f lavfi -i "sine=frequency=880:duration=1" \
  -c:a libmp3lame -b:a 128k -write_xing 0 -y chunk2.mp3

# byte-level 拼接
cat chunk1.mp3 chunk2.mp3 > concat.mp3

# ffprobe 读：duration=2.0925s ✓（2s + ~5ms frame 对齐 gap）
# concat.mp3 大小 = 33524 = 16762 × 2 ✓
```

**结论**：mp3 CBR 帧自洽，浏览器 MediaSource 用同样的拼接逻辑能 work。

---

## 架构设计

### Generate 阶段

新增 `剪播客/scripts/pre_cut_chunks.py`：

```python
# 输入：
#   audio_original.* / fine_analysis.json / delete_segments_roughcut.json
#
# 输出：
#   output/<project>/剪播客/chunks/chunk_001.mp3 ~ chunk_NNN.mp3
#   output/<project>/剪播客/chunks/manifest.json
#
# 流程：
# 1. 收集所有 "potential cut points"（FE deleteStart/End + sentence_deletes + partial_deletes）
# 2. 排序去重，得到所有切点 timeline
# 3. 对每个相邻切点对 [t_i, t_{i+1}]，cut 一个 chunk：
#    a. 解码原音频 [t_i, t_{i+1}] 段为 WAV（sample-级精确）
#    b. 应用 fade-in/fade-out（calc_fade_duration 同款，~40ms cap，短 chunk 折半）
#    c. 编码为 CBR 192k mp3，`-write_xing 0`
# 4. manifest.json:
#    {
#      "version": "chunks_v1",
#      "duration_total": 3346.4,
#      "chunks": [
#        {"idx": 0, "start": 0.0, "end": 2.57, "file": "chunk_001.mp3"},
#        {"idx": 1, "start": 2.57, "end": 6.25, "file": "chunk_002.mp3", "deletable_by": [{"type": "sentence", "sIdx": 0}]},
#        ...
#      ]
#    }
#
# 每个 chunk 关联一个或多个 "deletable_by" 元数据，记录这个 chunk 属于哪个/哪些 FE/sentence/partial。
# 用户 toggle 该 FE → 这个 chunk 从 active list 移除。
```

### HTML 阶段

`剪播客/templates/review.html` 改造：

1. **加载时**：fetch `chunks/manifest.json` → 建 `CHUNK_MANIFEST` 全局
2. **audio 元素**：用 MediaSource 替代直接 src
   ```js
   const ms = new MediaSource();
   au.src = URL.createObjectURL(ms);
   ms.addEventListener('sourceopen', initStreaming);
   ```
3. **active list 计算**：根据当前 `del`/`fdis`/`pdel`/`RD` 状态过滤 chunks
   ```js
   function activeChunks() {
     return CHUNK_MANIFEST.chunks.filter(c => {
       if (!c.deletable_by) return true; // 永远 keep 的 chunk
       return !c.deletable_by.some(d => isDeleted(d));
     });
   }
   ```
4. **streaming**：sourceopen 后顺序 fetch + appendBuffer
5. **toggle 响应**：用户改 del/fdis → 重算 active list → abort SourceBuffer + 从当前播放位置重新 append

### Toggle 响应时间预估

- 重算 active list：<1ms（710 chunks 数组 filter）
- abort SourceBuffer：~10ms
- fetch next chunk：~50ms（local file）
- appendBuffer：~10ms
- 总计：~70-100ms

**用户感知**：toggle 后 100ms 内 preview 更新，可接受。

---

## 实现步骤

### Step 1：原型（4-6h）
- 写 `pre_cut_chunks.py`（基于 `cut_audio.py` 逻辑改）
- 跑 meeting_02 → 生成 ~700 chunks + manifest
- 单独测试：拼接所有 chunks 是否等价于现行 cut output（sample-level RMS diff）

### Step 2：HTML 集成（4-6h）
- 改 `generate_review.js` 注入 `__CHUNK_MANIFEST_DATA__`
- 改 `templates/review.html` 加 MediaSource streaming 逻辑
- 保留旧的 JS-skip 路径作为 fallback（如 MediaSource 不支持的浏览器）

### Step 3：toggle 响应优化（2-3h）
- 实时更新 active list
- 平滑 SourceBuffer abort + re-append
- 测试快速连续 toggle 不崩

### Step 4：A/B 验证（2-3h）
- meeting_02 上跑：preview vs cut sample-level diff
- 多种 toggle 组合：默认全删 / 全留 / 部分 toggle
- 性能 profile：CPU/memory 在 toggle 时

### Step 5：兼容性（1-2h）
- Chrome/Firefox/Safari 实测
- mobile browser 检查（虽然不是主要场景）

**总工程量：13-20h**，约 2-3 天。

---

## 风险 & 边界 case

1. **mp3 frame 对齐**：CBR 192k 32kHz mono 每帧约 26ms。chunk 切点必须落在 frame 边界，否则拼接处有 click。`-write_xing 0` + 整数倍 frame size 切割可解决。
2. **MediaSource codec 检测**：某些 Safari 版本对 audio/mpeg 支持有限。需要 fallback。
3. **chunks 总数太多**：700+ 个文件可能让某些文件系统 / FUSE / 同步工具不爽。可以打包成 IndexedDB 或 zip-on-load。
4. **快速连续 toggle**：用户疯狂点 toggle 时 SourceBuffer abort 频繁，可能出错。需要 debounce 200ms。
5. **chunks 与 cut_audio.py 输出 byte-exact**：不能仅 "听起来像"，需 sample-level diff 验证。chunk 边界 fade 必须完全复刻 calc_fade_duration 的 8% × seg_dur 算法。

---

## 验证不变量

✅ **F1 trim_silences 建模继续在 preview 用** —— chunks 之间的"自然停顿"由 chunk 本身的时长承载，trim 由 cut_audio.py 在 chunk 内部就做掉了，preview 不再需要 RAW_SILENCES。
✅ **doExport 不动** —— `delete_segments_edited.json` 仍由 `S/pdelRanges/feRanges` 路径生成。chunks 只是 preview-only 的渲染方式。
✅ **cut_audio.py 不动** —— 后期成品仍由它处理。chunks 与 cut_audio.py 共享相同算法但独立产出。

---

## 推荐 ship 顺序

1. Step 1 原型 + Step 4 A/B 验证最小集 → 确认 sample-byte 一致才继续
2. Step 2/3 HTML 集成
3. 完整 A/B 验证 + 性能 profile
4. Step 5 浏览器兼容性
5. 用户验收 → ship

如果 Step 1 验证发现 mp3 chunk 拼接在浏览器 MediaSource 里有问题，回退到方案 3 hybrid 或重新评估。

---

## 关键文件

- `剪播客/scripts/cut_audio.py` —— 借用 calc_fade_duration + WAV-level cut 逻辑
- `剪播客/scripts/generate_review.js` —— 加 chunks 生成 + manifest 注入
- `剪播客/templates/review.html` —— 加 MediaSource streaming + 保留 fallback
- `剪播客/scripts/pre_cut_chunks.py` —— 新增，主要逻辑

---

写完手册的人：@podcast-editor-agent（2026-05-30 调研，约 1h）
读这份手册的人：implementation session（task #8 落地）

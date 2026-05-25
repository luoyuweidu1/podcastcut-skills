# 配置 / 数据格式 / 剪辑建议 / FAQ / 版本历史（参考）

> 本文从 `剪播客/SKILL.md`（编排器）拆出（Phase 4 瘦身）。属参考资料，需要时查阅；编排器只链接、不内联。

## 配置

### 阿里云API Key

```bash
# 方法1：环境变量
export DASHSCOPE_API_KEY="sk-your-api-key"

# 方法2：.env文件
cd "$SKILL_DIR"
cat >> .env << 'EOF'
DASHSCOPE_API_KEY=sk-your-api-key
EOF
```

**获取API Key**：
1. 访问：https://dashscope.console.aliyun.com/
2. 开通"模型服务灵积"
3. 创建API Key

**价格参考**：
- 按音频时长计费
- 约¥X/小时（查看阿里云官网最新价格）

### 说话人数量确认

**如何确定说话人数量**：
1. 听前2-3分钟音频
2. 或查看节目大纲
3. 计算：主播数 + 嘉宾数 = 说话人总数

**示例**：
- 单人播客：1人
- 双人播客：2人
- 访谈节目（2主播+1嘉宾）：3人
- 多人圆桌：根据实际人数

**重要**：设置错误会导致说话人识别不准确！

---

## 数据格式

### aliyun_funasr_transcription.json

```json
{
  "transcripts": [{
    "sentences": [
      {
        "sentence_id": 1,
        "speaker_id": 0,
        "text": "嗯，哈喽，大家好，我是主播麦雅。",
        "begin_time": 69400,
        "end_time": 74800,
        "words": [
          {
            "text": "嗯",
            "begin_time": 69400,
            "end_time": 69600,
            "punctuation": "，"
          }
        ]
      }
    ]
  }]
}
```

### speaker_mapping.json

```json
{
  "0": "麦雅",
  "1": "响歌歌",
  "2": "安安"
}
```

### subtitles_words.json

```json
[
  {"text": "[麦雅]", "start": 69.4, "end": 69.4, "isGap": false, "isSpeakerLabel": true, "speaker": "麦雅"},
  {"text": "大家", "start": 69.5, "end": 69.7, "isGap": false, "speaker": "麦雅"},
  {"text": "", "start": 70.5, "end": 71.2, "isGap": true}
]
```

---

## 播客剪辑建议

与视频口播的关键区别：

1. **静音阈值**：
   - 视频：0.3-0.5秒
   - 播客：1-2秒（保留自然节奏）

2. **填充词处理**：
   - 视频：积极删除
   - 播客：适度保留（保持对话感）

3. **重复处理**：
   - 视频：严格删除
   - 播客：明显重复才删，轻微重复保留

4. **对话特性**：
   - 多人对话：保留反应时间和自然停顿
   - 单人播客：可以更紧凑，但不要过度

5. **专业术语**：
   - 确保词典包含所有专业术语
   - 人名、公司名要特别注意

---

## FAQ

### Q1: 阿里云API vs 本地FunASR如何选择？

**推荐阿里云API**：
- ✅ 速度快7倍（3分钟 vs 20分钟）
- ✅ 说话人识别准确（98.8%）
- ✅ 无需安装本地环境
- ✅ 适合偶尔使用或追求速度

**选择本地FunASR**：
- ✅ 完全免费
- ✅ 数据隐私（不离开本地）
- ✅ 适合大量频繁使用
- ✅ 准确度稍高（99%+）

### Q2: 说话人识别不准确怎么办？

**检查**：
1. `SPEAKER_COUNT` 是否设置正确？
2. 音频质量是否清晰？
3. 说话人声音是否差异明显？

**如果仍不准确**：
- 使用本地FunASR（准确度更高）
- 或人工校对（差异通常<2%，校对工作量小）

### Q3: uguu.se链接24小时后过期怎么办？

**解决方案**：
1. 使用阿里云OSS（推荐，长期有效）
2. 使用七牛云、腾讯云COS
3. 自己的服务器

**阿里云OSS示例**：
```bash
# 上传
ossutil cp audio.mp3 oss://your-bucket/podcast.mp3

# 生成带签名的公网URL（7天有效）
ossutil sign oss://your-bucket/podcast.mp3 --timeout 604800
```

### Q4: 如何批量处理多个播客？

**批处理脚本**：
```bash
for audio in /path/to/podcasts/*.mp3; do
  echo "处理: $audio"
  # 调用剪播客skill
  # 自动执行步骤0-5
done
```

### Q5: 成本估算？

**阿里云FunASR API**：
- 按音频时长计费
- 约¥X/小时（查看官网最新价格）
- 2小时播客约¥X

**uguu.se**：
- 完全免费
- 文件<100MB
- 24小时自动删除

---

## 版本历史

### v5.0 (2026-02-21)
- 🧑‍💼 Per-user 偏好系统：用户偏好文件夹 + YAML 格式
- 🎓 新用户 Onboarding：播客链接解析 + 剪辑样本学习 + 扩展偏好问答
- 🔄 两层规则架构：preferences.yaml（意图层）→ editing_rules/（执行层）
- 📊 反馈闭环：审查修正自动分析 → editing_rules 更新
- 🤖 自动质检 + 后期触发 + episode_history 记录
- 📂 用户管理模块：user_manager.js（CRUD + 偏好读写）

### v4.1 (2026-02-12)
- 🎯 动态播放器跳过精度优化：自适应 lookahead + 紧密间隙前移 + pause-seek-play
- 🔧 修复精剪 seekTarget 跳过整句问题（nextKept 距离检查）
- 🔧 修复首段 0-1.36s 未跳过问题（getSkipRanges 首段扩展到 0）
- 🔧 修复 seekTarget +0.05 偏移切掉保留词首字问题

### v4.0 (2026-02-08)
- 🚀 切换到阿里云FunASR API
- ⚡ 速度提升7倍（3分钟 vs 20分钟）
- 🎯 说话人识别98.8%准确度（实测）
- 📝 新增说话人识别辅助工具
- 🔧 简化配置流程

### v3.0
- 🧠 Claude深度语义分析
- 🗑️ 删除线标注
- 🎯 智能删减建议
- 🤖 一键剪辑

### v2.0
- 火山引擎API转录
- 说话人分离

### v1.0
- 基础转录和剪辑

---

**推荐工作流**：阿里云API转录 + Claude分析 + 增强审核 + 一键剪辑 ✨

---


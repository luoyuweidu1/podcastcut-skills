# Archive - 已弃用的脚本

本目录包含v2/v3版本的旧脚本，已被v4.0的阿里云FunASR API替代。

## 📦 存档内容

### volcengine_transcribe.sh (2.8K)
- **版本**: v2/v3
- **用途**: 火山引擎API转录
- **弃用原因**: v4.0切换到阿里云FunASR API
- **替代**: `aliyun_funasr_transcribe.sh`
- **存档日期**: 2026-02-08

### volcengine_bigmodel_transcribe.sh (5.4K)
- **版本**: v2/v3
- **用途**: 火山引擎大模型API转录
- **弃用原因**: v4.0切换到阿里云FunASR API
- **替代**: `aliyun_funasr_transcribe.sh`
- **存档日期**: 2026-02-08

### generate_subtitles.js (3.2K)
- **版本**: v2/v3
- **用途**: 从火山引擎结果生成字级别转录
- **弃用原因**: v4.0使用阿里云API结果
- **替代**: `generate_subtitles_from_aliyun.js`
- **存档日期**: 2026-02-08

---

## 🔄 为什么切换到阿里云？

基于实测对比（2小时播客，3个说话人）：

| 维度 | 火山引擎 | 阿里云FunASR | 提升 |
|------|---------|-------------|------|
| **速度** | 变化较大 | 3分钟 (42x) | ⚡ 7倍提升 |
| **说话人准确度** | - | 98.8% | 🎯 实测验证 |
| **易用性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 📝 更简单 |

详见 `../CHANGELOG.md` v4.0 更新日志。

---

## ♻️ 恢复使用

如果需要恢复使用这些旧脚本：

```bash
# 从archive恢复
cp archive/volcengine_transcribe.sh .
cp archive/generate_subtitles.js .

# 配置火山引擎API Key
export VOLCENGINE_ACCESS_KEY="your-key"
```

但**不推荐**，因为v4.0的阿里云API在速度和准确度上都有显著优势。

---

**存档日期**: 2026-02-08
**对应版本**: v4.0.1

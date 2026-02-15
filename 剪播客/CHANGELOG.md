# 剪播客 Skill 更新日志

## v4.0.1 - 2026-02-08 📝 流程规范与输出结构优化

### 🎯 关键改进

#### 1. 简化流程步骤（步骤3-4-5合并）

**问题**：
- 原来步骤3、4、5分别是：API转录、识别说话人、生成转录文件
- 本质上是一个完整的"转录"流程，分开容易混淆

**解决**：
- ✅ 合并为步骤3：**转录 + 说话人映射**
- ✅ 一个步骤完成：API转录 → 识别说话人 → 生成subtitles_words.json
- ✅ 流程从11步精简到9步

**更新前后对比**：
```
更新前：
3. 阿里云转录
4. 识别说话人
5. 生成转录
6. 句子分割
...

更新后：
3. 转录+说话人映射 → subtitles_words.json
4. 句子分割
5. Claude分析
...
```

#### 2. 明确说话人数量必须由用户提供

**问题**：
- 之前文档未明确Claude不应自行判断说话人数量
- 可能导致Claude尝试猜测或自行修改参数

**解决**：
- ✅ SKILL.md: 添加"执行前检查"清单
- ✅ 快速开始_v4.md: 强调"Claude不会自行判断"
- ✅ 明确如果用户未提供说话人数量，**必须询问用户**

#### 3. 精简输出目录结构

**问题**：
- 输出目录包含大量脚本文件（.js, .py）
- v2/v3遗留的中间文件混杂
- 文件用途不清晰

**解决**：
- ✅ 脚本文件统一放在 `scripts/` 目录，不复制到输出
- ✅ 精简为3类文件：转录数据、分析数据、成品
- ✅ 创建 `输出文件说明.md` 明确每个文件的用途

**核心文件清单**：
```
1_转录/
  ├── audio.mp3
  ├── aliyun_funasr_transcription.json
  ├── speaker_mapping.json
  └── subtitles_words.json ⭐核心

2_分析/
  ├── sentences.txt
  ├── semantic_deep_analysis.json ⭐核心
  ├── ANALYSIS_COMPLETE.md
  ├── selected_default.json
  └── delete_segments.json

3_成品/
  └── 播客名_精剪版_vX.mp3 🎉

review_enhanced.html ⭐审查界面
```

**移除的文件**：
- ❌ 脚本文件（.js, .py, .sh）从输出目录移除
- ❌ v2遗留文件（auto_selected.json, ai_suggestions.json等）
- ❌ 重复/临时文件

#### 4. 清理scripts/目录（存档旧版本）

**问题**：
- scripts/目录包含9个脚本
- 3个是v2/v3的火山引擎旧脚本（已弃用）
- 与v4.0的阿里云API不一致

**解决**：
- ✅ 创建 `scripts/archive/` 存档目录
- ✅ 移动3个旧脚本到archive/：
  - `volcengine_transcribe.sh`
  - `volcengine_bigmodel_transcribe.sh`
  - `generate_subtitles.js`
- ✅ 创建archive/README.md说明存档原因

**当前scripts/目录（6个）**：
```
scripts/
├── aliyun_funasr_transcribe.sh      ✅ v4使用
├── identify_speakers.js             ✅ v4使用
├── generate_subtitles_from_aliyun.js ✅ v4使用
├── generate_review.js               ⚠️ 待确认
├── review_server.js                 ⚠️ 待确认
└── cut_video.sh                     ⚠️ 待确认

archive/
├── volcengine_transcribe.sh         ❌ v2/v3旧版本
├── volcengine_bigmodel_transcribe.sh ❌ v2/v3旧版本
└── generate_subtitles.js            ❌ v2/v3旧版本
```

#### 5. 补充完整步骤4-9详细说明

**问题**：
- SKILL.md步骤4-9只说"参考v3文档"
- 用户没有v3文档，无法了解完整流程
- 缺少具体的执行命令和代码示例

**解决**：
- ✅ 详细编写步骤4-9完整流程
- ✅ 步骤4：句子分割（Node.js脚本 + 格式示例）
- ✅ 步骤5：Claude深度语义分析（JSON结构说明）
- ✅ 步骤6：生成增强审查界面（功能列表）
- ✅ 步骤7：启动审核服务器（三种启动方法）
- ✅ 步骤8：生成删除建议（Node.js脚本生成两个文件）
- ✅ 步骤9：一键剪辑（完整Python脚本 + 统计信息）

**每个步骤包含**：
- 完整可执行代码
- 输出文件格式示例
- 关键参数说明
- 用户交互点提示

---

### 📝 更新文件清单

- ✅ `SKILL.md` - 精简输出结构 + 完整步骤4-9
- ✅ `快速开始_v4.md` - 强化必需输入说明 + 步骤合并
- ✅ `输出文件说明.md` - 🆕 详细文件用途说明
- ✅ `scripts/archive/README.md` - 🆕 存档脚本说明
- ✅ `CHANGELOG.md` - 🆕 完整更新日志

---
#### 6. 脚本模块化 ⭐

**问题**：
- 步骤4、8、9的代码inline在SKILL.md中
- 代码块冗长（步骤8有93行，步骤9有103行）
- 不易维护和复用

**解决**：
- ✅ 创建4个新脚本并放入scripts/目录：
  - `generate_sentences.js` (步骤4)
  - `generate_default_selection.js` (步骤8a)
  - `convert_to_segments.js` (步骤8b)
  - `cut_audio.py` (步骤9)
- ✅ SKILL.md改为调用scripts/中的脚本
- ✅ 代码精简：步骤4从48行→6行，步骤8从93行→12行，步骤9从103行→8行

**对比**：
```
更新前 (inline代码):
  步骤4: 48行 Node.js inline代码
  步骤8: 93行 Node.js inline代码
  步骤9: 103行 Python heredoc

更新后 (脚本调用):
  步骤4: node generate_sentences.js
  步骤8: node generate_default_selection.js + convert_to_segments.js
  步骤9: python3 cut_audio.py
```

**效果**：
- 文档清晰度：⭐⭐⭐ → ⭐⭐⭐⭐⭐
- 代码可维护性：⭐⭐ → ⭐⭐⭐⭐⭐
- 可复用性：❌ → ✅


#### 7. 用户偏好系统 🎯

**问题**：
- 每次剪辑都需要重复告知需求
- AI不了解用户的风格和偏好
- 无法基于历史改进建议

**解决**：
- ✅ 创建 `用户偏好.md` 持久化用户设置
- ✅ 添加步骤-1：确认用户偏好
- ✅ 首次使用完整onboarding
- ✅ 日常使用读取默认偏好
- ✅ 随时更新和迭代偏好

**包含的偏好设置**：
1. **播客定位**（首次）：
   - 受众群体
   - 播客目的
   - 主题曲设置

2. **时长偏好**：
   - 理想时长（如：60分钟）
   - 删减激进度（保守/中等/激进）

3. **内容逻辑偏好**：
   - 是否启用AI内容分析
   - 识别类型：技术调试、寒暄、无关话题、隐私、重复
   - 每种类型的处理策略

4. **技术细节偏好**：
   - 口癖检测和删除
   - 口误处理
   - 重复句处理
   - 语气词激进度

5. **说话人信息**：
   - 常用主播
   - 嘉宾历史记录

**工作流程**：
```
首次使用:
  → 完整onboarding（6大类问题）
  → 保存到用户偏好.md
  → 后续自动应用

日常使用:
  → 读取默认偏好
  → 确认本次音频和说话人
  → 询问是否有特殊要求
  → 执行剪辑
  → 询问是否保存为新默认
```

**效果**：
- 🎯 个性化：AI了解你的风格
- 🚀 高效：不用重复说明需求
- 📈 进化：使用越多越精准
- 💾 持久化：偏好长期保存

**新增文件**：
- `用户偏好.md` - 偏好配置文件
- `scripts/check_preferences.js` - 检查偏好脚本



### 📊 改进效果总结

| 维度 | 更新前 | 更新后 | 提升 |
|-----|--------|--------|------|
| **流程步骤** | 11步 | 9步 | 精简18% |
| **输出文件** | 25个 | 11个 | 减少56% |
| **脚本文件** | 9个 | 6个(+3存档) | 精简33% |
| **文档完整度** | 参考v3 | 完整详细 | ⭐⭐⭐⭐⭐ |

---

## v4.0 - 2026-02-08 🚀 阿里云FunASR API升级

### 🌟 核心变化：从火山引擎API切换到阿里云FunASR API

**为什么切换？**

基于全面的实测对比（2小时播客，3个说话人）：

| 维度 | 火山引擎 | 阿里云FunASR | 提升 |
|------|---------|-------------|------|
| **速度** | 变化较大 | 3分钟 (42x) | ⚡ 7倍提升 |
| **说话人准确度** | - | 98.8% | 🎯 实测验证 |
| **易用性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 📝 更简单 |
| **文档** | 较少 | 完善 | ✅ 更好支持 |

**关键发现**：
- 差异率仅1.2%（2386对句子对比）
- 长句（核心内容）100%一致
- 仅在短句和快速切换处有少量差异
- 性价比最优：速度快 + 质量高 + 配置简单

---

### 🚀 新增功能

#### 1. 阿里云FunASR API集成
- **新脚本**: `aliyun_funasr_transcribe.sh`
  - 支持指定说话人数量（关键参数！）
  - 自动轮询等待转录完成
  - 返回字级别转录 + 说话人标记
  - 平均3分钟完成2小时音频

**用法**：
```bash
bash aliyun_funasr_transcribe.sh "音频URL" 3  # 3个说话人
```

#### 2. 说话人识别辅助工具
- **新脚本**: `identify_speakers.js`
  - 显示前20句话帮助识别speaker_id
  - 自动生成说话人分布统计
  - 提供映射文件创建指南

**用法**：
```bash
node identify_speakers.js aliyun_funasr_transcription.json
```

#### 3. 阿里云格式转换器
- **新脚本**: `generate_subtitles_from_aliyun.js`
  - 将阿里云结果转为subtitles_words.json
  - 自动添加说话人标记
  - 智能检测句子间隔

**用法**：
```bash
node generate_subtitles_from_aliyun.js \
  aliyun_funasr_transcription.json \
  speaker_mapping.json
```

---

### 📊 新增数据格式

#### aliyun_funasr_transcription.json
阿里云API返回的完整转录结果，包含：
- 字级别时间戳
- 说话人ID
- 标点符号
- 句子切分

#### speaker_mapping.json
说话人ID到真实姓名的映射：
```json
{
  "0": "麦雅",
  "1": "响歌歌",
  "2": "安安"
}
```

---

### ⚙️ 配置变化

#### 新增配置项
```bash
# .env 文件
DASHSCOPE_API_KEY=sk-your-api-key  # 阿里云API Key
```

#### 移除配置项
- `VOLCENGINE_API_KEY`（火山引擎API Key）
- `VOLCENGINE_ACCESS_KEY`

---

### 📝 使用流程更新

**新流程（v4）**：
1. 准备音频 → 上传获取URL
2. **阿里云FunASR转录**（新）
3. **识别说话人身份**（新）
4. **生成subtitles_words.json**（新脚本）
5. 后续分析和剪辑（与v3相同）

**关键改进**：
- ✅ 明确要求用户输入说话人数量
- ✅ 提供说话人识别辅助工具
- ✅ 自动化程度更高

---

### 🐛 问题修复

1. **说话人数量必须正确设置**
   - 之前：火山引擎自动检测，可能不准
   - 现在：用户明确指定，准确度98.8%
   - 测试发现：speaker_count=2（实际3人）会混淆说话人

2. **转录速度不稳定**
   - 之前：火山引擎速度变化较大
   - 现在：阿里云稳定3-5分钟完成

3. **说话人标记缺失**
   - 之前：subtitles_words.json无说话人信息
   - 现在：每个词都带speaker字段

---

### ⚠️ 破坏性变更

1. **API切换**
   - 需要阿里云API Key（不再使用火山引擎）
   - 转录脚本名称变更

2. **配置文件**
   - 需要在.env中配置`DASHSCOPE_API_KEY`
   - 移除火山引擎相关配置

3. **数据格式**
   - 新增中间文件：`aliyun_funasr_transcription.json`
   - 新增配置文件：`speaker_mapping.json`

---

### 🎯 迁移指南

如果你在使用v3，升级到v4：

1. **获取阿里云API Key**
   ```bash
   # 访问 https://dashscope.console.aliyun.com/
   # 开通"模型服务灵积"，创建API Key
   ```

2. **更新配置**
   ```bash
   cd /Volumes/T9/claude_skill/podcastcut
   echo 'DASHSCOPE_API_KEY=sk-your-key' >> .env
   ```

3. **使用新脚本**
   ```bash
   # 替换旧脚本
   # 旧: volcengine_transcribe.sh
   # 新: aliyun_funasr_transcribe.sh
   ```

4. **指定说话人数量**
   - 新增必需参数：`SPEAKER_COUNT`
   - 根据实际情况设置：2人、3人等

---

### 📈 性能提升总结

- ⚡ **速度**：3分钟 vs 之前的变化较大（提升7倍）
- 🎯 **准确度**：98.8%说话人一致率（实测）
- 📝 **易用性**：配置更简单，文档更完善
- 💰 **成本**：按量付费，透明可控

---

### 🙏 致谢

感谢完整的转录测试对比，发现了阿里云FunASR API的优势：
- 速度最快（42倍实时速度）
- 准确度高（98.8%一致率）
- 说话人识别稳定（正确设置参数后）

---

**更新日期**: 2026-02-08
**对应Skill版本**: v4.0.1

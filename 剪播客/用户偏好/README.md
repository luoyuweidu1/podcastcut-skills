# 用户配置

Per-user 偏好管理。每个用户有独立的配置文件夹。

## 目录结构

```
用户配置/
├── default/                 # 默认模板（新用户从这里克隆）
│   ├── preferences.yaml     # 意图层：时长、激进度、开关
│   ├── podcast_profile.yaml # 播客信息：链接、主题、受众
│   ├── post_production.yaml # 后期偏好：片头片尾、时间戳
│   ├── editing_rules/       # 执行层：具体操作参数
│   ├── learning_history.json # 反馈学习历史
│   └── episode_history.json  # 每期处理记录
└── [user_id]/               # 实际用户（结构同 default/）
```

## 偏好层级

```
preferences.yaml（意图层，用户设置）
    ↓ 初始化
editing_rules/（执行层，系统自动管理）
    ↑ 样本学习微调
    ↑ 反馈闭环微调
```

- `preferences.yaml` 存高层意图（"激进删填充词"）
- `editing_rules/` 存具体参数（"嗯的删除率 85%"），由系统根据样本学习和反馈自动维护
- 全局基础规则在 `用户习惯/` 目录，所有用户共享

## 用户管理

```bash
# 检查用户偏好
node scripts/check_preferences.js [userId]

# 代码中使用
const UserManager = require('./scripts/user_manager');
UserManager.createUser('lixiang');
const prefs = UserManager.loadPreferences('lixiang');
```

## 环境变量

- `PODCASTCUT_USER` — 当前用户 ID（可选，默认为 "default"）

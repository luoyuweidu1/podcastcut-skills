#!/usr/bin/env node
/**
 * 用户配置管理模块
 *
 * 提供 per-user 偏好的 CRUD 操作。
 * 其他 Agent 的脚本通过 require 此模块来读写用户配置。
 *
 * API:
 *   getCurrentUser()                → userId string
 *   getUserConfigPath(userId)       → absolute path
 *   createUser(userId)              → void (克隆 default/)
 *   loadPreferences(userId)         → parsed YAML object
 *   savePreferences(userId, obj)    → void
 *   loadPostProduction(userId)      → parsed YAML object
 *   savePostProduction(userId, obj) → void
 *   loadPodcastProfile(userId)      → parsed YAML object
 *   savePodcastProfile(userId, obj) → void
 *   loadEditingRules(userId)        → merged rules (base + user overrides)
 *   saveEditingRule(userId, name, obj) → void
 *   loadLearningHistory(userId)     → JSON object
 *   appendLearningEvent(userId, event) → void
 *   loadEpisodeHistory(userId)      → JSON object
 *   appendEpisode(userId, episode)  → void
 *   listUsers()                     → string[]
 *   userExists(userId)              → boolean
 *
 * 用法:
 *   node user_manager.js [command] [args]
 *   node user_manager.js list
 *   node user_manager.js create <userId>
 *   node user_manager.js check <userId>
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// --- 路径常量 ---

const SKILL_DIR = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(SKILL_DIR, '用户配置');
const DEFAULT_DIR = path.join(CONFIG_DIR, 'default');
const BASE_RULES_DIR = path.join(SKILL_DIR, '用户习惯');

// --- 辅助函数 ---

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

function writeYaml(filePath, obj) {
  const content = yaml.dump(obj, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false
  });
  fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// --- 核心 API ---

/**
 * 获取当前用户 ID
 * 优先级：环境变量 PODCASTCUT_USER > "default"
 */
function getCurrentUser() {
  return process.env.PODCASTCUT_USER || 'default';
}

/**
 * 获取用户配置目录的绝对路径
 */
function getUserConfigPath(userId) {
  return path.join(CONFIG_DIR, userId || getCurrentUser());
}

/**
 * 检查用户是否存在
 */
function userExists(userId) {
  return fs.existsSync(getUserConfigPath(userId));
}

/**
 * 列出所有用户（排除 README.md 等非目录项）
 */
function listUsers() {
  if (!fs.existsSync(CONFIG_DIR)) return [];
  return fs.readdirSync(CONFIG_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'default')
    .map(d => d.name);
}

/**
 * 创建新用户（从 default/ 克隆）
 */
function createUser(userId) {
  if (!userId || userId === 'default') {
    throw new Error('用户 ID 不能为空或 "default"');
  }
  const userDir = getUserConfigPath(userId);
  if (fs.existsSync(userDir)) {
    throw new Error(`用户 "${userId}" 已存在: ${userDir}`);
  }
  copyDirRecursive(DEFAULT_DIR, userDir);

  // 更新元数据
  const prefs = loadPreferences(userId);
  if (prefs && prefs.meta) {
    prefs.meta.created_at = new Date().toISOString().slice(0, 10);
    prefs.meta.last_updated = new Date().toISOString().slice(0, 10);
    savePreferences(userId, prefs);
  }
  return userDir;
}

// --- 偏好读写 ---

function loadPreferences(userId) {
  const filePath = path.join(getUserConfigPath(userId), 'preferences.yaml');
  return readYaml(filePath);
}

function savePreferences(userId, obj) {
  const filePath = path.join(getUserConfigPath(userId), 'preferences.yaml');
  if (obj.meta) {
    obj.meta.last_updated = new Date().toISOString().slice(0, 10);
  }
  writeYaml(filePath, obj);
}

function loadPostProduction(userId) {
  const filePath = path.join(getUserConfigPath(userId), 'post_production.yaml');
  return readYaml(filePath);
}

function savePostProduction(userId, obj) {
  const filePath = path.join(getUserConfigPath(userId), 'post_production.yaml');
  if (obj.meta) {
    obj.meta.last_updated = new Date().toISOString().slice(0, 10);
  }
  writeYaml(filePath, obj);
}

function loadPodcastProfile(userId) {
  const filePath = path.join(getUserConfigPath(userId), 'podcast_profile.yaml');
  return readYaml(filePath);
}

function savePodcastProfile(userId, obj) {
  const filePath = path.join(getUserConfigPath(userId), 'podcast_profile.yaml');
  writeYaml(filePath, obj);
}

// --- Editing Rules（两层合并） ---

/**
 * 加载用户的 editing rules（基础规则 + 用户覆盖合并）
 *
 * 返回: { base_rules_dir, user_overrides: { [ruleName]: yamlObj }, merged_summary }
 *
 * 合并逻辑：
 * - 基础规则在 用户习惯/ 目录（10 个 markdown 文件），由 Claude 直接读取
 * - 用户覆盖在 editing_rules/ 目录（YAML 文件），存具体参数
 * - 如果用户覆盖存在，优先使用用户覆盖的值
 */
function loadEditingRules(userId) {
  const userRulesDir = path.join(getUserConfigPath(userId), 'editing_rules');
  const overrides = {};

  if (fs.existsSync(userRulesDir)) {
    for (const file of fs.readdirSync(userRulesDir)) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const name = path.basename(file, path.extname(file));
        overrides[name] = readYaml(path.join(userRulesDir, file));
      }
    }
  }

  return {
    base_rules_dir: BASE_RULES_DIR,
    user_overrides: overrides,
    has_overrides: Object.keys(overrides).length > 0
  };
}

/**
 * 保存单个 editing rule 覆盖
 */
function saveEditingRule(userId, ruleName, ruleObj) {
  const userRulesDir = path.join(getUserConfigPath(userId), 'editing_rules');
  fs.mkdirSync(userRulesDir, { recursive: true });
  const filePath = path.join(userRulesDir, `${ruleName}.yaml`);
  writeYaml(filePath, ruleObj);
}

// --- 历史记录 ---

function loadLearningHistory(userId) {
  const filePath = path.join(getUserConfigPath(userId), 'learning_history.json');
  return readJson(filePath) || { version: '1.0', learning_events: [], preference_evolution: {} };
}

function appendLearningEvent(userId, event) {
  const history = loadLearningHistory(userId);
  event.date = event.date || new Date().toISOString().slice(0, 10);
  history.learning_events.push(event);
  const filePath = path.join(getUserConfigPath(userId), 'learning_history.json');
  writeJson(filePath, history);
}

function loadEpisodeHistory(userId) {
  const filePath = path.join(getUserConfigPath(userId), 'episode_history.json');
  return readJson(filePath) || { version: '1.0', episodes: [] };
}

function appendEpisode(userId, episode) {
  const history = loadEpisodeHistory(userId);
  episode.date = episode.date || new Date().toISOString().slice(0, 10);
  history.episodes.push(episode);
  const filePath = path.join(getUserConfigPath(userId), 'episode_history.json');
  writeJson(filePath, history);
}

// --- CLI ---

function printUsage() {
  console.log(`用法: node user_manager.js <command> [args]

命令:
  list                    列出所有用户
  create <userId>         创建新用户（从 default/ 克隆）
  check [userId]          检查用户偏好状态
  prefs [userId]          打印用户偏好（JSON）
  rules [userId]          打印用户 editing rules 概况`);
}

if (require.main === module) {
  const [,, command, ...args] = process.argv;

  switch (command) {
    case 'list': {
      const users = listUsers();
      console.log(`已注册用户 (${users.length}):`, users.length ? users.join(', ') : '(无，仅 default)');
      break;
    }
    case 'create': {
      const userId = args[0];
      if (!userId) { console.error('缺少 userId'); process.exit(1); }
      const dir = createUser(userId);
      console.log(`✅ 用户 "${userId}" 已创建: ${dir}`);
      break;
    }
    case 'check': {
      const userId = args[0] || getCurrentUser();
      if (!userExists(userId)) {
        console.log(JSON.stringify({ exists: false, needsOnboarding: true, userId }));
        process.exit(1);
      }
      const prefs = loadPreferences(userId);
      const isConfigured = prefs
        && prefs.audience && prefs.audience !== ''
        && prefs.purpose && prefs.purpose !== ''
        && prefs.duration && prefs.duration.target_minutes > 0;
      console.log(JSON.stringify({
        exists: true,
        needsOnboarding: !isConfigured,
        isConfigured,
        userId,
        configPath: getUserConfigPath(userId)
      }, null, 2));
      process.exit(isConfigured ? 0 : 1);
      break;
    }
    case 'prefs': {
      const userId = args[0] || getCurrentUser();
      console.log(JSON.stringify(loadPreferences(userId), null, 2));
      break;
    }
    case 'rules': {
      const userId = args[0] || getCurrentUser();
      const rules = loadEditingRules(userId);
      console.log(`基础规则目录: ${rules.base_rules_dir}`);
      console.log(`用户覆盖: ${rules.has_overrides ? Object.keys(rules.user_overrides).join(', ') : '(无)'}`);
      break;
    }
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

// --- 导出 ---

module.exports = {
  getCurrentUser,
  getUserConfigPath,
  userExists,
  listUsers,
  createUser,
  loadPreferences,
  savePreferences,
  loadPostProduction,
  savePostProduction,
  loadPodcastProfile,
  savePodcastProfile,
  loadEditingRules,
  saveEditingRule,
  loadLearningHistory,
  appendLearningEvent,
  loadEpisodeHistory,
  appendEpisode,
  // 路径常量（供其他脚本引用）
  SKILL_DIR,
  CONFIG_DIR,
  DEFAULT_DIR,
  BASE_RULES_DIR
};

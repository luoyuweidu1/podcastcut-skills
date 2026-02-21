#!/usr/bin/env node
/**
 * 播客链接解析器
 *
 * 从小宇宙或 Apple Podcasts 链接提取播客元信息。
 * 结果写入用户的 podcast_profile.yaml。
 *
 * 用法:
 *   node parse_podcast_link.js <url> [userId]
 *
 * 支持的链接格式:
 *   - 小宇宙: https://www.xiaoyuzhoufm.com/podcast/xxx
 *   - Apple Podcasts: https://podcasts.apple.com/xx/podcast/xxx/idNNN
 *
 * 输出: JSON 格式的解析结果（同时写入 podcast_profile.yaml）
 */

const https = require('https');
const http = require('http');
const UserManager = require('./user_manager');

// --- URL 检测 ---

function detectPlatform(url) {
  if (/xiaoyuzhoufm\.com/.test(url)) return 'xiaoyuzhou';
  if (/podcasts\.apple\.com/.test(url)) return 'apple';
  if (/itunes\.apple\.com/.test(url)) return 'apple';
  return null;
}

// --- HTTP 请求辅助 ---

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

// --- 小宇宙解析 ---

async function parseXiaoyuzhou(url) {
  const html = await fetchUrl(url);

  // 从 HTML meta 标签和 JSON-LD 提取信息
  const result = {
    link: url,
    platform: 'xiaoyuzhou',
    name: '',
    description: '',
    theme: [],
    audience: '',
    style: ''
  };

  // og:title
  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
    || html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) result.name = titleMatch[1].trim();

  // og:description
  const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)
    || html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  if (descMatch) result.description = descMatch[1].trim();

  // 尝试从 JSON-LD 或 Next.js __NEXT_DATA__ 提取更多信息
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const podcast = nextData?.props?.pageProps?.podcast
        || nextData?.props?.pageProps?.podcastData;
      if (podcast) {
        result.name = podcast.title || result.name;
        result.description = podcast.description || result.description;
        if (podcast.episodeCount) result.episodes_analyzed = 0;
      }
    } catch (e) {
      // JSON 解析失败，用已有的 meta 数据
    }
  }

  return result;
}

// --- Apple Podcasts 解析 ---

async function parseApplePodcasts(url) {
  // 从 URL 提取 podcast ID
  const idMatch = url.match(/id(\d+)/);
  if (!idMatch) throw new Error('无法从 Apple Podcasts URL 提取 ID');

  const podcastId = idMatch[1];

  // 使用 iTunes Search API
  const apiUrl = `https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`;
  const response = await fetchUrl(apiUrl);
  const data = JSON.parse(response);

  if (!data.results || data.results.length === 0) {
    throw new Error(`Apple Podcasts 未找到 ID ${podcastId} 的播客`);
  }

  const podcast = data.results[0];

  return {
    link: url,
    platform: 'apple',
    name: podcast.collectionName || podcast.trackName || '',
    description: podcast.description || '',
    theme: podcast.genres || [],
    audience: '',
    style: '',
    _raw: {
      artist: podcast.artistName,
      feedUrl: podcast.feedUrl,
      trackCount: podcast.trackCount,
      artworkUrl: podcast.artworkUrl600 || podcast.artworkUrl100
    }
  };
}

// --- 主逻辑 ---

async function parsePodcastLink(url, userId) {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error(`不支持的链接格式: ${url}\n支持: 小宇宙 (xiaoyuzhoufm.com), Apple Podcasts (podcasts.apple.com)`);
  }

  let profile;
  if (platform === 'xiaoyuzhou') {
    profile = await parseXiaoyuzhou(url);
  } else if (platform === 'apple') {
    profile = await parseApplePodcasts(url);
  }

  // 清理 _raw 字段（不写入 YAML）
  const rawData = profile._raw;
  delete profile._raw;

  // 设置默认值
  profile.episodes_analyzed = profile.episodes_analyzed || 0;

  // 写入用户配置
  if (userId) {
    UserManager.savePodcastProfile(userId, profile);
    console.error(`✅ 已保存到 ${UserManager.getUserConfigPath(userId)}/podcast_profile.yaml`);
  }

  return { profile, rawData };
}

// --- CLI ---

async function main() {
  const url = process.argv[2];
  const userId = process.argv[3] || UserManager.getCurrentUser();

  if (!url) {
    console.log(`用法: node parse_podcast_link.js <url> [userId]

支持:
  - 小宇宙: https://www.xiaoyuzhoufm.com/podcast/xxx
  - Apple Podcasts: https://podcasts.apple.com/xx/podcast/xxx/idNNN

示例:
  node parse_podcast_link.js "https://www.xiaoyuzhoufm.com/podcast/abc123" lixiang`);
    process.exit(1);
  }

  try {
    const { profile, rawData } = await parsePodcastLink(url, userId);
    console.log(JSON.stringify(profile, null, 2));
    if (rawData) {
      console.error('\n补充信息（未写入 YAML）:');
      console.error(JSON.stringify(rawData, null, 2));
    }
  } catch (error) {
    console.error(`❌ 解析失败: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parsePodcastLink, detectPlatform };

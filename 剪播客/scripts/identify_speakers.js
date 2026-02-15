#!/usr/bin/env node
/**
 * 辅助识别说话人 - 显示前20句话帮助用户确定speaker_id对应谁
 *
 * 用法: node identify_speakers.js <aliyun_transcription.json>
 */

const fs = require('fs');

if (process.argv.length < 3) {
    console.error('❌ 错误：缺少参数');
    console.error('');
    console.error('用法: node identify_speakers.js <aliyun_transcription.json>');
    console.error('示例: node identify_speakers.js aliyun_funasr_transcription.json');
    process.exit(1);
}

const aliyunFile = process.argv[2];

// 读取转录结果
let data;
try {
    data = JSON.parse(fs.readFileSync(aliyunFile, 'utf8'));
} catch (error) {
    console.error(`❌ 读取文件失败: ${aliyunFile}`);
    console.error(error.message);
    process.exit(1);
}

const sentences = data.transcripts[0].sentences;

console.log('='.repeat(80));
console.log('🎤 说话人识别助手');
console.log('='.repeat(80));
console.log('');
console.log(`📊 总句数: ${sentences.length}`);

// 统计说话人分布
const speakerCounts = {};
sentences.forEach(s => {
    speakerCounts[s.speaker_id] = (speakerCounts[s.speaker_id] || 0) + 1;
});

console.log('\n📈 说话人分布:');
Object.keys(speakerCounts).sort((a, b) => a - b).forEach(spk => {
    const count = speakerCounts[spk];
    const pct = (count / sentences.length * 100).toFixed(1);
    console.log(`   Speaker ${spk}: ${count}句 (${pct}%)`);
});

console.log('\n');
console.log('='.repeat(80));
console.log('🔍 前20句话（用于识别说话人身份）');
console.log('='.repeat(80));
console.log('');

// 显示前20句
sentences.slice(0, 20).forEach((s, i) => {
    const time = (s.begin_time / 1000).toFixed(1);
    const speaker = s.speaker_id;
    const text = s.text.length > 60 ? s.text.substring(0, 60) + '...' : s.text;

    console.log(`${(i + 1).toString().padStart(2)}. [Speaker ${speaker}] ${time}s`);
    console.log(`    ${text}`);
    console.log('');
});

console.log('='.repeat(80));
console.log('📝 如何创建speaker_mapping.json');
console.log('='.repeat(80));
console.log('');
console.log('根据上面的输出，查找自我介绍片段（通常在开头1-2分钟），例如：');
console.log('  "我是主播麦雅" → Speaker 0 = 麦雅');
console.log('  "我是主播小哥哥" → Speaker 1 = 响歌歌');
console.log('  "大家好我是安安" → Speaker 2 = 安安');
console.log('');
console.log('然后创建 speaker_mapping.json 文件：');
console.log('');
console.log('cat > speaker_mapping.json << EOF');
console.log('{');
console.log('  "0": "麦雅",');
console.log('  "1": "响歌歌",');
console.log('  "2": "安安"');
console.log('}');
console.log('EOF');
console.log('');
console.log('⚠️  注意：根据你的实际情况调整speaker_id和姓名');
console.log('');

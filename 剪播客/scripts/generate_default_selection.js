#!/usr/bin/env node
/**
 * 步骤8a: 从语义分析生成默认删除建议
 *
 * 用法: node generate_default_selection.js [semantic_deep_analysis.json]
 * 输出: selected_default.json
 */

const fs = require('fs');

const analysisFile = process.argv[2] || 'semantic_deep_analysis.json';

if (!fs.existsSync(analysisFile)) {
  console.error(`❌ 找不到文件: ${analysisFile}`);
  console.error('');
  console.error('请先运行步骤5生成语义分析文件');
  process.exit(1);
}

const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
const selected = {};

analysis.sentences.forEach(s => {
  // delete类型直接标记删除
  if (s.action === 'delete') {
    selected[s.sentenceIdx] = true;
  }
  // compress类型根据比例决定（压缩70%以上视为删除）
  else if (s.action && s.action.startsWith('compress_')) {
    const ratio = parseInt(s.action.split('_')[1]);
    if (ratio >= 70) {
      selected[s.sentenceIdx] = true;
    }
  }
});

fs.writeFileSync('selected_default.json', JSON.stringify(selected, null, 2));

console.log(`✅ 已生成 selected_default.json`);
console.log(`   建议删除: ${Object.keys(selected).filter(k => selected[k]).length} 句`);
console.log(`   总句数: ${analysis.sentences.length}`);

const deleteCount = Object.keys(selected).filter(k => selected[k]).length;
const deleteRatio = (deleteCount / analysis.sentences.length * 100).toFixed(1);
console.log(`   删除比例: ${deleteRatio}%`);

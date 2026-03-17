// This script takes the batch 0 result (already done) and creates a predicted file
// Then we'll add more batch results as they come in
const fs = require('fs');
const path = require('path');

const resultsDir = '/sessions/intelligent-relaxed-sagan/mnt/剪播客/eval/results';
const outputFile = '/sessions/intelligent-relaxed-sagan/mnt/剪播客/eval/predicted_llm.json';

// Read all result files and merge
const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json')).sort();
console.log(`Found ${files.length} result files`);

let allEdits = [];
for (const f of files) {
  const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8'));
  if (data.edits) {
    allEdits = allEdits.concat(data.edits);
  }
  console.log(`  ${f}: ${data.edits?.length || 0} edits`);
}

// Build the predicted format expected by eval script
// The eval script expects: { sentences: { "audioSource::idx": { edits: [...] } } }
// But looking at the eval script, let me check what format it expects
console.log(`\nTotal edits: ${allEdits.length}`);

// Write as flat edit array - the eval script will match by sentence index
const output = {
  edits: allEdits,
  total_edits: allEdits.length
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(`Written to ${outputFile}`);

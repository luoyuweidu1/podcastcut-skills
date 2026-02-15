#!/bin/bash
#
# 阿里云FunASR API转录脚本（用于播客剪辑）
# 用法: bash aliyun_funasr_transcribe.sh <音频URL> <说话人数量>
#

set -e

# 自动加载 .env（如果 DASHSCOPE_API_KEY 未设置）
ENV_FILE="/Volumes/T9/claude_skill/podcastcut/.env"
if [ -z "$DASHSCOPE_API_KEY" ] && [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

# 检查参数
if [ -z "$1" ]; then
    echo "❌ 错误：请提供音频URL"
    echo ""
    echo "用法: bash aliyun_funasr_transcribe.sh <音频URL> <说话人数量>"
    echo "示例: bash aliyun_funasr_transcribe.sh \"https://example.com/audio.mp3\" 3"
    exit 1
fi

AUDIO_URL="$1"
SPEAKER_COUNT="${2:-2}"  # 默认2个说话人

# 检查API Key
if [ -z "$DASHSCOPE_API_KEY" ]; then
    echo "❌ 错误：未设置DASHSCOPE_API_KEY环境变量"
    echo ""
    echo "请设置API Key:"
    echo "  export DASHSCOPE_API_KEY='your-api-key'"
    echo ""
    echo "或在 /Volumes/T9/claude_skill/podcastcut/.env 中配置"
    exit 1
fi

API_KEY="$DASHSCOPE_API_KEY"

echo "🎤 提交阿里云FunASR转录任务"
echo "   音频URL: $AUDIO_URL"
echo "   说话人数: $SPEAKER_COUNT"
echo ""

# 提交任务
RESPONSE=$(curl -s -X POST "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-DashScope-Async: enable" \
  -d '{
    "model": "fun-asr",
    "input": {
      "file_urls": ["'"$AUDIO_URL"'"]
    },
    "parameters": {
      "diarization_enabled": true,
      "speaker_count": '$SPEAKER_COUNT',
      "channel_id": [0]
    }
  }')

# 检查提交结果
TASK_ID=$(echo "$RESPONSE" | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
  echo "❌ 提交失败"
  echo "$RESPONSE"
  exit 1
fi

echo "✅ 任务已提交"
echo "   任务ID: $TASK_ID"
echo ""
echo "⏳ 等待转录完成（预计3-15分钟）..."

# 轮询结果
ATTEMPT=0
MAX_ATTEMPTS=300  # 最多等待25分钟

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  sleep 5
  ATTEMPT=$((ATTEMPT + 1))

  QUERY_RESPONSE=$(curl -s -X GET "https://dashscope.aliyuncs.com/api/v1/tasks/$TASK_ID" \
    -H "Authorization: Bearer $API_KEY")

  STATUS=$(echo "$QUERY_RESPONSE" | grep -o '"task_status":"[^"]*"' | cut -d'"' -f4)

  if [ "$STATUS" = "SUCCEEDED" ]; then
    echo ""
    echo "✅ 转录完成！"

    # 保存API响应
    echo "$QUERY_RESPONSE" > aliyun_funasr_result.json
    echo "   已保存API响应: aliyun_funasr_result.json"

    # 提取并下载转录URL
    TRANSCRIPTION_URL=$(echo "$QUERY_RESPONSE" | grep -o '"transcription_url":"[^"]*"' | cut -d'"' -f4)

    if [ -n "$TRANSCRIPTION_URL" ]; then
      echo "   下载转录内容..."
      curl -s "$TRANSCRIPTION_URL" > aliyun_funasr_transcription.json
      echo "   已保存转录结果: aliyun_funasr_transcription.json"

      # 统计信息
      SENTENCE_COUNT=$(grep -o '"sentence_id"' aliyun_funasr_transcription.json | wc -l | tr -d ' ')
      echo ""
      echo "📊 转录统计:"
      echo "   总句数: $SENTENCE_COUNT"

      # 说话人分布
      node << 'EOF'
const data = require('./aliyun_funasr_transcription.json');
const sentences = data.transcripts[0].sentences;
const speakers = {};
sentences.forEach(s => {
  speakers[s.speaker_id] = (speakers[s.speaker_id] || 0) + 1;
});
console.log('   说话人分布:');
Object.keys(speakers).sort().forEach(spk => {
  const count = speakers[spk];
  const pct = (count / sentences.length * 100).toFixed(1);
  console.log(`     Speaker ${spk}: ${count}句 (${pct}%)`);
});
EOF
    fi

    exit 0

  elif [ "$STATUS" = "FAILED" ]; then
    echo ""
    echo "❌ 转录失败"
    echo "$QUERY_RESPONSE"
    exit 1
  else
    if [ $((ATTEMPT % 12)) -eq 0 ]; then
      echo "   处理中... ($((ATTEMPT * 5)) 秒) 状态: $STATUS"
    else
      echo -n "."
    fi
  fi
done

echo ""
echo "❌ 超时（等待 $((MAX_ATTEMPTS * 5)) 秒）"
exit 1

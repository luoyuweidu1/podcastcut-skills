#!/bin/bash
#
# 火山引擎大模型录音文件识别（支持说话人分离）
#
# 用法: ./volcengine_bigmodel_transcribe.sh <audio_url>
# 输出: volcengine_result.json
#

AUDIO_URL="$1"

if [ -z "$AUDIO_URL" ]; then
  echo "❌ 用法: ./volcengine_bigmodel_transcribe.sh <audio_url>"
  exit 1
fi

# 获取 API Key
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$(dirname "$(dirname "$SCRIPT_DIR")")/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ 找不到 $ENV_FILE"
  echo "请创建: cp .env.example .env 并填入认证信息"
  exit 1
fi

# 读取认证信息
APP_KEY=$(grep VOLCENGINE_APP_KEY "$ENV_FILE" | cut -d'=' -f2)
ACCESS_KEY=$(grep VOLCENGINE_ACCESS_KEY "$ENV_FILE" | cut -d'=' -f2)
RESOURCE_ID=$(grep VOLCENGINE_RESOURCE_ID "$ENV_FILE" | cut -d'=' -f2 || echo "volc.bigasr.auc")

if [ -z "$APP_KEY" ] || [ -z "$ACCESS_KEY" ]; then
  echo "❌ 缺少认证信息"
  echo "请在 $ENV_FILE 中配置："
  echo "  VOLCENGINE_APP_KEY=your_app_key"
  echo "  VOLCENGINE_ACCESS_KEY=your_access_key"
  exit 1
fi

# 生成请求ID（UUID）
REQUEST_ID=$(uuidgen)

echo "🎤 提交火山引擎大模型转录任务（含说话人分离）..."
echo "音频 URL: $AUDIO_URL"
echo "请求 ID: $REQUEST_ID"

# 读取热词词典
DICT_FILE="$(dirname "$SCRIPT_DIR")/音频处理/词典.txt"
HOT_WORDS_JSON=""
if [ -f "$DICT_FILE" ]; then
  # 转换为 JSON 数组格式: [{"word":"词1"},{"word":"词2"}]
  HOT_WORDS_JSON=$(cat "$DICT_FILE" | grep -v '^$' | while read word; do echo "{\"word\":\"$word\"}"; done | paste -sd ',' - | sed 's/^/[/' | sed 's/$/]/')
  WORD_COUNT=$(cat "$DICT_FILE" | grep -v '^$' | wc -l | tr -d ' ')
  echo "📖 加载热词: $WORD_COUNT 个"
fi

# 检测音频格式
AUDIO_FORMAT="mp3"
if [[ "$AUDIO_URL" == *.wav ]]; then
  AUDIO_FORMAT="wav"
elif [[ "$AUDIO_URL" == *.m4a ]] || [[ "$AUDIO_URL" == *.aac ]]; then
  AUDIO_FORMAT="aac"
fi

# 构建请求体
if [ -n "$HOT_WORDS_JSON" ]; then
  REQUEST_BODY=$(cat <<EOF
{
  "user": {
    "uid": "podcast_user"
  },
  "audio": {
    "format": "$AUDIO_FORMAT",
    "url": "$AUDIO_URL"
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": true,
    "enable_ddc": true,
    "enable_speaker_info": true,
    "corpus": {
      "boosting_words": $HOT_WORDS_JSON
    }
  }
}
EOF
)
else
  REQUEST_BODY=$(cat <<EOF
{
  "user": {
    "uid": "podcast_user"
  },
  "audio": {
    "format": "$AUDIO_FORMAT",
    "url": "$AUDIO_URL"
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": true,
    "enable_ddc": true,
    "enable_speaker_info": true
  }
}
EOF
)
fi

# 步骤1: 提交任务（使用 -i 获取 headers）
SUBMIT_RESPONSE=$(curl -s -i -L -X POST "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit" \
  -H "X-Api-App-Key: $APP_KEY" \
  -H "X-Api-Access-Key: $ACCESS_KEY" \
  -H "X-Api-Resource-Id: $RESOURCE_ID" \
  -H "X-Api-Request-Id: $REQUEST_ID" \
  -H "X-Api-Sequence: -1" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY")

# 从 Header 中提取状态码
STATUS_CODE=$(echo "$SUBMIT_RESPONSE" | grep -i "x-api-status-code:" | cut -d':' -f2 | tr -d ' \r\n')

if [ "$STATUS_CODE" != "20000000" ]; then
  echo "❌ 提交失败，状态码: $STATUS_CODE"
  echo "响应:"
  echo "$SUBMIT_RESPONSE"
  exit 1
fi

echo "✅ 任务已提交，ID: $REQUEST_ID"
echo "⏳ 等待转录完成（大模型处理，通常3-30分钟）..."

# 步骤2: 轮询结果
MAX_ATTEMPTS=360  # 最多等待 30 分钟（每 5 秒查一次）
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  sleep 5
  ATTEMPT=$((ATTEMPT + 1))

  QUERY_RESPONSE=$(curl -s -i -L -X POST "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query" \
    -H "X-Api-App-Key: $APP_KEY" \
    -H "X-Api-Access-Key: $ACCESS_KEY" \
    -H "X-Api-Resource-Id: $RESOURCE_ID" \
    -H "X-Api-Request-Id: $REQUEST_ID" \
    -H "Content-Type: application/json" \
    -d '{}')

  # 先尝试从 Header 中读取状态码
  STATUS=$(echo "$QUERY_RESPONSE" | grep -i "x-api-status-code:" | cut -d':' -f2 | tr -d ' \r\n')

  # 如果 Header 中没有，从 body 中读取
  if [ -z "$STATUS" ]; then
    BODY=$(echo "$QUERY_RESPONSE" | sed -n '/^{/,${p}')
    STATUS=$(echo "$BODY" | grep -o '"code":[0-9]*' | head -1 | cut -d':' -f2)
  fi

  if [ -z "$STATUS" ]; then
    # 尝试从响应中提取状态信息
    echo -n "."
    continue
  fi

  if [ "$STATUS" = "20000000" ]; then
    # 成功完成 - 只保存 body 部分（JSON）
    BODY=$(echo "$QUERY_RESPONSE" | sed -n '/^{/,${p}')
    echo "$BODY" > volcengine_result.json
    echo ""
    echo "✅ 转录完成，已保存 volcengine_result.json"

    # 显示统计
    UTTERANCES=$(echo "$BODY" | grep -o '"text"' | wc -l | tr -d ' ')
    SPEAKERS=$(echo "$BODY" | grep -o '"speaker_id":[0-9]*' | cut -d':' -f2 | sort -u | wc -l | tr -d ' ')

    echo "📝 识别到 $UTTERANCES 段语音"
    if [ "$SPEAKERS" -gt 0 ]; then
      echo "👥 识别到 $SPEAKERS 个说话人"
    fi
    exit 0
  elif [ "$STATUS" = "20000001" ] || [ "$STATUS" = "20000002" ]; then
    # 处理中或队列中
    if [ $((ATTEMPT % 12)) -eq 0 ]; then
      echo ""
      echo "⏳ 仍在处理中... ($((ATTEMPT * 5)) 秒)"
    else
      echo -n "."
    fi
  else
    # 其他错误
    echo ""
    echo "❌ 转录失败，状态码: $STATUS"
    echo "响应:"
    echo "$QUERY_RESPONSE"
    exit 1
  fi
done

echo ""
echo "❌ 超时，任务未完成（等待时间: $((MAX_ATTEMPTS * 5)) 秒）"
echo "建议：继续使用相同的 REQUEST_ID 手动查询"
exit 1

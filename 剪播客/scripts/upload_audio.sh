#!/bin/bash
#
# 多服务fallback上传脚本
# 依次尝试多个免费文件托管服务，直到成功
#

set -e

if [ -z "$1" ]; then
    echo "用法: bash upload_audio.sh <音频文件路径>"
    exit 1
fi

AUDIO_FILE="$1"

if [ ! -f "$AUDIO_FILE" ]; then
    echo "❌ 错误：文件不存在 $AUDIO_FILE"
    exit 1
fi

FILE_SIZE=$(du -h "$AUDIO_FILE" | cut -f1)
echo "📤 准备上传音频文件"
echo "   文件: $AUDIO_FILE"
echo "   大小: $FILE_SIZE"
echo ""

# 尝试1: uguu.se (快速，48小时保留，最大100MB)
echo "🔄 [1/5] 尝试 uguu.se (48小时保留)..."
RESPONSE=$(curl -s --max-time 120 -F "files[]=@$AUDIO_FILE" https://uguu.se/upload.php 2>&1 || echo "")
URL=$(echo "$RESPONSE" | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
if [[ "$URL" =~ ^https?:// ]]; then
    echo "✅ 上传成功！"
    echo "$URL"
    echo "$URL" > audio_url.txt
    echo ""
    echo "   URL已保存到: audio_url.txt"
    exit 0
fi
echo "   ❌ 失败"
echo ""

# 尝试2: 0x0.st (支持大文件，48小时保留)
echo "🔄 [2/5] 尝试 0x0.st (48小时保留)..."
RESPONSE=$(curl -s -F "file=@$AUDIO_FILE" https://0x0.st 2>&1 || echo "")
if [[ "$RESPONSE" =~ ^https?:// ]]; then
    echo "✅ 上传成功！"
    echo "$RESPONSE"
    echo "$RESPONSE" > audio_url.txt
    echo ""
    echo "   URL已保存到: audio_url.txt"
    exit 0
fi
echo "   ❌ 失败"
echo ""

# 尝试3: file.io (一次性下载，永久保留直到被下载)
echo "🔄 [3/5] 尝试 file.io (一次性下载)..."
RESPONSE=$(curl -s -F "file=@$AUDIO_FILE" https://file.io 2>&1 || echo "")
URL=$(echo "$RESPONSE" | grep -o '"link":"[^"]*"' | cut -d'"' -f4 || echo "")
if [[ "$URL" =~ ^https?:// ]]; then
    echo "✅ 上传成功！"
    echo "$URL"
    echo "$URL" > audio_url.txt
    echo ""
    echo "   URL已保存到: audio_url.txt"
    echo "   ⚠️  注意：此链接只能下载一次"
    exit 0
fi
echo "   ❌ 失败"
echo ""

# 尝试3: tmpfiles.org (24小时保留)
echo "🔄 [4/5] 尝试 tmpfiles.org (24小时保留)..."
RESPONSE=$(curl -s -F "file=@$AUDIO_FILE" https://tmpfiles.org/api/v1/upload 2>&1 || echo "")
URL=$(echo "$RESPONSE" | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | sed 's/tmpfiles.org\//tmpfiles.org\/dl\//' || echo "")
if [[ "$URL" =~ ^https?:// ]]; then
    echo "✅ 上传成功！"
    echo "$URL"
    echo "$URL" > audio_url.txt
    echo ""
    echo "   URL已保存到: audio_url.txt"
    exit 0
fi
echo "   ❌ 失败"
echo ""

# 尝试4: catbox.moe (永久保留，最大200MB)
echo "🔄 [5/5] 尝试 catbox.moe (永久保留)..."
RESPONSE=$(curl -s -F "reqtype=fileupload" -F "fileToUpload=@$AUDIO_FILE" https://catbox.moe/user/api.php 2>&1 || echo "")
if [[ "$RESPONSE" =~ ^https?://.*catbox.moe.* ]]; then
    echo "✅ 上传成功！"
    echo "$RESPONSE"
    echo "$RESPONSE" > audio_url.txt
    echo ""
    echo "   URL已保存到: audio_url.txt"
    exit 0
fi
echo "   ❌ 失败"
echo ""

# 所有服务都失败
echo "❌ 所有上传服务均失败"
echo ""
echo "💡 备选方案："
echo "   1. 使用阿里云OSS (需要配置，见SKILL.md)"
echo "   2. 使用ngrok暴露本地文件 (需要安装ngrok)"
echo "   3. 手动上传到网盘后获取分享链接"
echo ""
exit 1

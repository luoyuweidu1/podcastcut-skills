#!/usr/bin/env python3
"""
用 Fish Audio TTS 逐段生成音频

用法：
    python tts_generate.py <修正稿.json> <voice_models.json> <输出目录>

示例：
    python tts_generate.py podcast_修正稿.json ./samples/voice_models.json ./tts_output

输入：
    - 修正稿 JSON（segments 数组，每段有 speaker 和 text）
    - voice_models.json（speaker名 → model_id）

输出：
    segment_001.mp3, segment_002.mp3, ...

依赖：
    - FISH_API_KEY in .env
    - pip install requests python-dotenv
"""
import json
import os
import sys
import time

import requests
from dotenv import load_dotenv


def tts_generate(api_key, text, model_id, output_file):
    """调用 Fish Audio TTS 生成音频"""
    url = "https://api.fish.audio/v1/tts"

    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "reference_id": model_id,
        },
        timeout=120
    )

    if response.status_code != 200:
        print(f"  错误: HTTP {response.status_code}")
        print(f"  响应: {response.text[:200]}")
        return False

    with open(output_file, 'wb') as f:
        f.write(response.content)

    return True


def main():
    if len(sys.argv) < 4:
        print("用法: python tts_generate.py <修正稿.json> <voice_models.json> <输出目录>")
        print("\n示例:")
        print("  python tts_generate.py podcast_修正稿.json ./samples/voice_models.json ./tts_output")
        sys.exit(1)

    script_file = sys.argv[1]
    models_file = sys.argv[2]
    output_dir = sys.argv[3]

    # 加载 API Key
    load_dotenv()
    api_key = os.getenv("FISH_API_KEY")
    if not api_key:
        print("错误: 未找到 FISH_API_KEY，请在 .env 文件中设置")
        sys.exit(1)

    # 读取修正稿
    with open(script_file, 'r', encoding='utf-8') as f:
        script_data = json.load(f)

    segments = script_data['segments']
    print(f"修正稿共 {len(segments)} 段")

    # 读取声音模型映射
    with open(models_file, 'r', encoding='utf-8') as f:
        voice_models = json.load(f)

    print(f"声音模型:")
    for name, mid in voice_models.items():
        print(f"  {name} → {mid}")

    os.makedirs(output_dir, exist_ok=True)

    success_count = 0
    fail_count = 0

    for i, segment in enumerate(segments):
        speaker = segment['speaker']
        text = segment['text']

        if not text.strip():
            print(f"  跳过空段落 {i+1}")
            continue

        model_id = voice_models.get(speaker)
        if not model_id:
            print(f"  警告: 未找到说话人 '{speaker}' 的模型，跳过段落 {i+1}")
            fail_count += 1
            continue

        output_file = os.path.join(output_dir, f"segment_{i+1:03d}.mp3")
        print(f"  [{i+1}/{len(segments)}] {speaker}: {text[:30]}...")

        ok = tts_generate(api_key, text, model_id, output_file)
        if ok:
            file_size = os.path.getsize(output_file)
            print(f"    输出: {output_file} ({file_size} bytes)")
            success_count += 1
        else:
            fail_count += 1

        # 避免 API 限流
        time.sleep(1)

    print(f"\n完成! 成功 {success_count} 段，失败 {fail_count} 段")
    print(f"输出目录: {output_dir}")


if __name__ == '__main__':
    main()

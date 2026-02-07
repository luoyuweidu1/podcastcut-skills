#!/usr/bin/env python3
"""
上传音频样本到 Fish Audio 创建声音模型

支持每个说话人多个音频样本（Fish Audio 推荐 2-3 段）。

用法：
    python create_voice_model.py <样本目录> <speaker名字映射JSON>

示例：
    python create_voice_model.py ./samples '{"0":"xujia","1":"嘉宾女"}'

输入：
    - 样本目录下的 speaker_*_sample_*.wav 文件
    - speaker名字映射 JSON（spk_id → 名字）

输出：
    <样本目录>/voice_models.json — speaker名 → model_id 映射

依赖：
    - FISH_API_KEY in .env
    - pip install requests python-dotenv
"""
import json
import os
import re
import sys
import time

import requests
from dotenv import load_dotenv


def create_model(api_key, sample_files, speaker_name):
    """上传多个音频样本到 Fish Audio 创建声音模型"""
    url = "https://api.fish.audio/model"

    # 构建多文件上传
    files = []
    for sf in sample_files:
        files.append(("voices", (os.path.basename(sf), open(sf, 'rb'), "audio/wav")))

    try:
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
            files=files,
            data={
                "type": "tts",
                "title": speaker_name,
                "train_mode": "fast",
                "visibility": "private"
            },
            timeout=120
        )
    finally:
        # 关闭文件句柄
        for _, (_, f, _) in files:
            f.close()

    if response.status_code not in (200, 201):
        print(f"  错误: HTTP {response.status_code}")
        print(f"  响应: {response.text}")
        return None

    result = response.json()
    return result.get("_id")


def main():
    if len(sys.argv) < 3:
        print("用法: python create_voice_model.py <样本目录> <speaker名字映射JSON>")
        print("\n示例:")
        print('  python create_voice_model.py ./samples \'{"0":"xujia","1":"嘉宾女"}\'')
        print("\n说明:")
        print("  - 样本目录下需要有 speaker_*_sample_*.wav 文件")
        print("  - 每个说话人可以有多个样本（推荐 2-3 段）")
        print("  - FISH_API_KEY 需要在 .env 文件中设置")
        sys.exit(1)

    sample_dir = sys.argv[1]
    speaker_names = json.loads(sys.argv[2])

    # 加载 API Key
    load_dotenv()
    api_key = os.getenv("FISH_API_KEY")
    if not api_key:
        print("错误: 未找到 FISH_API_KEY，请在 .env 文件中设置")
        sys.exit(1)

    # 按说话人分组样本文件
    speaker_files = {}
    for f in sorted(os.listdir(sample_dir)):
        match = re.match(r'speaker_(\d+)_sample(?:_\d+)?\.wav', f)
        if match:
            spk_id = match.group(1)
            if spk_id not in speaker_files:
                speaker_files[spk_id] = []
            speaker_files[spk_id].append(os.path.join(sample_dir, f))

    if not speaker_files:
        print(f"错误: 在 {sample_dir} 中未找到 speaker_*_sample*.wav 文件")
        sys.exit(1)

    print(f"找到 {len(speaker_files)} 个说话人的样本")

    voice_models = {}

    for spk_id, files in sorted(speaker_files.items()):
        speaker_name = speaker_names.get(spk_id, f"speaker_{spk_id}")

        # 只处理映射中存在的说话人
        if spk_id not in speaker_names:
            print(f"\n跳过说话人 {spk_id}（不在名字映射中）")
            continue

        print(f"\n上传 {speaker_name} 的 {len(files)} 个样本:")
        for f in files:
            print(f"  - {os.path.basename(f)}")

        model_id = create_model(api_key, files, speaker_name)

        if model_id:
            voice_models[speaker_name] = model_id
            print(f"  模型创建成功: {model_id}")
        else:
            print(f"  模型创建失败!")

        # 避免 API 限流
        time.sleep(2)

    # 保存映射
    output_file = os.path.join(sample_dir, "voice_models.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(voice_models, f, ensure_ascii=False, indent=2)

    print(f"\n完成! 模型映射已保存到: {output_file}")
    print(f"映射内容:")
    for name, mid in voice_models.items():
        print(f"  {name} → {mid}")


if __name__ == '__main__':
    main()

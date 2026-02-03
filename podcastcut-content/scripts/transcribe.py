#!/usr/bin/env python3
"""
FunASR 转录脚本（句子级时间戳 + 说话人分离）

功能：
转录音频/视频文件，输出带句子级时间戳和说话人ID的 JSON 文件

用法：
    python transcribe.py <音频文件> <输出目录>

示例：
    python transcribe.py podcast.mp3 ./output
    python transcribe.py /path/to/video.mp4 /path/to/output

输出：
    <输出目录>/podcast_transcript.json

注意：
    必须使用完整模型路径 + VAD + Punc + Speaker 四个模型
    否则无法获取 sentence_info（句子级时间戳）
"""
import json
import os
import sys
from pathlib import Path


def transcribe_with_speakers(audio_path, output_dir):
    """
    转录音频，输出句子级时间戳 + 说话人ID

    必须使用完整的模型路径和 VAD/Punc 模型，否则只返回字符级时间戳
    """
    from funasr import AutoModel

    print("加载模型...", flush=True)
    model = AutoModel(
        model="iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        vad_model="iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        punc_model="iic/punc_ct-transformer_cn-en-common-vocab471067-large",
        spk_model="iic/speech_campplus_sv_zh-cn_16k-common",
        device="cpu",
        disable_update=True
    )

    print(f"开始转录: {audio_path}", flush=True)
    result = model.generate(
        input=audio_path,
        batch_size_s=300
    )

    # 提取句子级时间戳
    sentences = []
    for item in result:
        if 'sentence_info' in item:
            for sent in item['sentence_info']:
                sentences.append({
                    'text': sent['text'],
                    'start': round(sent['start'] / 1000, 3),
                    'end': round(sent['end'] / 1000, 3),
                    'spk': sent.get('spk', 0)
                })

    # 获取音频时长
    duration = 0
    if sentences:
        duration = sentences[-1]['end']

    # 构建输出
    output = {
        'file': os.path.basename(audio_path),
        'duration': duration,
        'sentences': sentences
    }

    # 保存
    output_path = os.path.join(output_dir, 'podcast_transcript.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # 统计说话人
    speakers = set(s['spk'] for s in sentences)

    print(f"转录完成!", flush=True)
    print(f"  - 句子数: {len(sentences)}", flush=True)
    print(f"  - 说话人数: {len(speakers)}", flush=True)
    print(f"  - 保存到: {output_path}", flush=True)

    return output


def main():
    if len(sys.argv) < 3:
        print("用法: python transcribe.py <音频文件> <输出目录>")
        print("\n示例:")
        print("  python transcribe.py podcast.mp3 ./output")
        print("  python transcribe.py /path/to/video.mp4 /path/to/output")
        print("\n注意:")
        print("  - 必须使用完整模型路径 + VAD + Punc + Speaker 四个模型")
        print("  - 2小时音频约需 10-15 分钟（CPU）")
        sys.exit(1)

    audio_path = sys.argv[1]
    output_dir = sys.argv[2]

    # 检查输入文件
    if not os.path.exists(audio_path):
        print(f"错误: 文件不存在: {audio_path}")
        sys.exit(1)

    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)

    # 转录
    transcribe_with_speakers(audio_path, output_dir)


if __name__ == '__main__':
    main()

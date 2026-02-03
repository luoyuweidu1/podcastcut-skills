#!/usr/bin/env python3
"""
生成逐字稿（Markdown格式）

功能：
从 transcript JSON 生成带说话人标签和时间戳的 Markdown 逐字稿

用法：
    python generate_transcript.py <transcript.json> <输出.md> [说话人映射JSON]

示例：
    python generate_transcript.py podcast_transcript.json podcast_逐字稿.md
    python generate_transcript.py podcast_transcript.json podcast_逐字稿.md '{"0":"Maia","1":"响歌歌"}'

输出格式：
    **Maia** 00:05
    开始了。大家好，欢迎来到今天的播客。

    **响歌歌** 00:15
    我是主播响歌歌。
"""
import json
import sys
from pathlib import Path


def format_time(seconds):
    """将秒数格式化为 MM:SS 或 HH:MM:SS"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def generate_transcript(transcript_path, output_path, speaker_names=None):
    """
    生成逐字稿

    参数：
        transcript_path: transcript JSON 文件路径
        output_path: 输出 Markdown 文件路径
        speaker_names: 说话人ID到名字的映射，如 {0: "Maia", 1: "响歌歌"}
    """
    if speaker_names is None:
        speaker_names = {}

    with open(transcript_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sentences = data.get('sentences', [])
    duration = data.get('duration', 0)
    file_name = Path(data.get('file', 'unknown')).name

    lines = []
    lines.append("# 播客逐字稿\n")
    lines.append(f"**文件**: {file_name}")
    lines.append(f"**总时长**: {format_time(duration)}")
    lines.append(f"**句子数**: {len(sentences)}")
    lines.append("\n---\n")

    current_speaker = None
    current_block = []
    block_start = None

    for sent in sentences:
        spk = sent.get('spk', 0)
        speaker = speaker_names.get(spk, f"说话人{spk}")

        if spk != current_speaker:
            # 输出之前的块
            if current_block:
                prev_speaker = speaker_names.get(current_speaker, f"说话人{current_speaker}")
                lines.append(f"**{prev_speaker}** {format_time(block_start)}")
                lines.append(''.join(current_block))
                lines.append("")

            current_speaker = spk
            current_block = [sent['text']]
            block_start = sent['start']
        else:
            current_block.append(sent['text'])

    # 最后一个块
    if current_block:
        speaker = speaker_names.get(current_speaker, f"说话人{current_speaker}")
        lines.append(f"**{speaker}** {format_time(block_start)}")
        lines.append(''.join(current_block))
        lines.append("")

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"逐字稿已保存到: {output_path}")
    print(f"  - 句子数: {len(sentences)}")
    print(f"  - 总时长: {format_time(duration)}")


def main():
    if len(sys.argv) < 3:
        print("用法: python generate_transcript.py <transcript.json> <输出.md> [说话人映射JSON]")
        print("\n示例:")
        print('  python generate_transcript.py podcast_transcript.json podcast_逐字稿.md')
        print('  python generate_transcript.py podcast_transcript.json podcast_逐字稿.md \'{"0":"Maia","1":"响歌歌"}\'')
        sys.exit(1)

    transcript_path = sys.argv[1]
    output_path = sys.argv[2]

    # 解析说话人映射
    speaker_names = {}
    if len(sys.argv) > 3:
        try:
            speaker_map = json.loads(sys.argv[3])
            # 转换 key 为 int
            speaker_names = {int(k): v for k, v in speaker_map.items()}
        except json.JSONDecodeError as e:
            print(f"警告: 无法解析说话人映射 JSON: {e}")

    generate_transcript(transcript_path, output_path, speaker_names)


if __name__ == '__main__':
    main()

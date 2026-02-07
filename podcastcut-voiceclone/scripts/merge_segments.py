#!/usr/bin/env python3
"""
合并所有 TTS 段落音频为最终播客

用法：
    python merge_segments.py <segment目录> <输出文件>

示例：
    python merge_segments.py ./tts_output podcast_voiceclone.mp3

输入：
    segment_001.mp3, segment_002.mp3, ... （按文件名排序）

输出：
    podcast_voiceclone.mp3
"""
import os
import subprocess
import sys


def main():
    if len(sys.argv) < 3:
        print("用法: python merge_segments.py <segment目录> <输出文件>")
        print("\n示例:")
        print("  python merge_segments.py ./tts_output podcast_voiceclone.mp3")
        sys.exit(1)

    segment_dir = sys.argv[1]
    output_file = sys.argv[2]

    # 查找所有 segment 文件，按名称排序
    segments = sorted([
        f for f in os.listdir(segment_dir)
        if f.startswith('segment_') and f.endswith('.mp3')
    ])

    if not segments:
        print(f"错误: 在 {segment_dir} 中未找到 segment_*.mp3 文件")
        sys.exit(1)

    print(f"找到 {len(segments)} 个音频段落")

    # 创建 FFmpeg concat 列表
    list_file = os.path.join(segment_dir, 'concat_list.txt')
    with open(list_file, 'w') as f:
        for seg in segments:
            seg_path = os.path.abspath(os.path.join(segment_dir, seg))
            f.write(f"file '{seg_path}'\n")

    # 用 FFmpeg concat 合并
    cmd = [
        'ffmpeg', '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', list_file,
        '-acodec', 'libmp3lame',
        '-ab', '192k',
        output_file
    ]

    print(f"合并中...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"FFmpeg 错误:\n{result.stderr}")
        sys.exit(1)

    # 清理临时文件
    os.remove(list_file)

    file_size = os.path.getsize(output_file)
    print(f"完成! 输出: {output_file} ({file_size / 1024 / 1024:.1f} MB)")


if __name__ == '__main__':
    main()

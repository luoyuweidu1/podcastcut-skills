#!/usr/bin/env python3
"""
快速模式删除合并 - 减少 FFmpeg 分段数，加速处理

用法: python merge_deletions_fast.py <工作目录>

输入:
  - deletions_unified.json 或 deletions.json

输出:
  - deletions_fast.json (合并后)
  - keep_segments_fast.json (保留片段)
  - filter_fast.txt (FFmpeg filter)
  - ffmpeg_cmd_fast.sh (执行命令)

优化参数:
  - MIN_DELETE_DURATION = 0.3   忽略 < 0.3s 的删除
  - MIN_SILENCE_DURATION = 2.0  静音阈值
  - MERGE_GAP_THRESHOLD = 1.0   合并间隔 < 1.0s 的删除

效果:
  - 570 分段 → 154 分段
  - 38 分钟 → 3.5 分钟 (加速 11 倍)
"""

import json
import sys
from pathlib import Path

# 快速模式参数
MIN_DELETE_DURATION = 0.3   # 忽略 < 0.3s 的删除
MIN_SILENCE_DURATION = 2.0  # 静音阈值
MERGE_GAP_THRESHOLD = 1.0   # 合并间隔


def filter_deletions(deletions):
    """过滤微小删除"""
    return [
        d for d in deletions
        if d['end'] - d['start'] >= MIN_DELETE_DURATION
    ]


def merge_deletions(deletions, gap_threshold=MERGE_GAP_THRESHOLD):
    """合并相邻的删除"""
    if not deletions:
        return []

    sorted_dels = sorted(deletions, key=lambda x: x['start'])
    merged = []
    current = {'start': sorted_dels[0]['start'], 'end': sorted_dels[0]['end']}

    for d in sorted_dels[1:]:
        if d['start'] <= current['end'] + gap_threshold:
            current['end'] = max(current['end'], d['end'])
        else:
            merged.append(current)
            current = {'start': d['start'], 'end': d['end']}

    merged.append(current)
    return merged


def calculate_keep_segments(deletions, total_duration):
    """从删除列表计算保留片段"""
    if not deletions:
        return [{'start': 0, 'end': total_duration}]

    segments = []
    prev_end = 0

    for d in sorted(deletions, key=lambda x: x['start']):
        if d['start'] > prev_end:
            segments.append({'start': prev_end, 'end': d['start']})
        prev_end = max(prev_end, d['end'])

    if prev_end < total_duration:
        segments.append({'start': prev_end, 'end': total_duration})

    return segments


def generate_ffmpeg_filter(segments, output_path):
    """生成 FFmpeg filter_complex 脚本"""
    lines = []
    labels = []

    for i, seg in enumerate(segments):
        line = f"[0:a]atrim=start={seg['start']:.3f}:end={seg['end']:.3f},asetpts=PTS-STARTPTS[a{i}];"
        lines.append(line)
        labels.append(f"[a{i}]")

    # concat
    concat_line = ''.join(labels) + f"concat=n={len(segments)}:v=0:a=1[outa]"
    lines.append(concat_line)

    with open(output_path, 'w') as f:
        f.write('\n'.join(lines))


def generate_ffmpeg_cmd(input_file, filter_path, output_file, cmd_path):
    """生成 FFmpeg 执行命令"""
    cmd = f'''#!/bin/bash
ffmpeg -y -i "{input_file}" \\
  -filter_complex_script "{filter_path}" \\
  -map "[outa]" \\
  -c:a libmp3lame -q:a 2 \\
  "{output_file}"
'''
    with open(cmd_path, 'w') as f:
        f.write(cmd)


def main():
    if len(sys.argv) < 2:
        print("用法: python merge_deletions_fast.py <工作目录> [输入文件] [输出文件]")
        sys.exit(1)

    work_dir = Path(sys.argv[1])
    input_file = sys.argv[2] if len(sys.argv) > 2 else None
    output_file = sys.argv[3] if len(sys.argv) > 3 else None

    # 加载删除清单
    deletions_path = work_dir / "deletions_unified.json"
    if not deletions_path.exists():
        deletions_path = work_dir / "deletions.json"

    with open(deletions_path, 'r', encoding='utf-8') as f:
        deletions = json.load(f)

    print(f"原始删除项: {len(deletions)}")

    # 过滤微小删除
    filtered = filter_deletions(deletions)
    print(f"过滤后: {len(filtered)}")

    # 合并相邻删除
    merged = merge_deletions(filtered)
    print(f"合并后: {len(merged)}")

    # ⚠️ 边界精度修复：删除结束时间减 0.001s，避免与下一段重叠
    for d in merged:
        d['end'] = round(d['end'] - 0.001, 3)

    # 保存合并后的删除清单
    with open(work_dir / "deletions_fast.json", 'w', encoding='utf-8') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    # 获取总时长
    transcript_path = work_dir / "transcript_chars.json"
    if transcript_path.exists():
        with open(transcript_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            total_duration = data.get('duration', 7200)
    else:
        total_duration = 7200

    # 计算保留片段
    keep_segments = calculate_keep_segments(merged, total_duration)
    print(f"保留片段: {len(keep_segments)}")

    with open(work_dir / "keep_segments_fast.json", 'w', encoding='utf-8') as f:
        json.dump(keep_segments, f, ensure_ascii=False, indent=2)

    # 生成 FFmpeg filter
    filter_path = work_dir / "filter_fast.txt"
    generate_ffmpeg_filter(keep_segments, filter_path)
    print(f"已生成: {filter_path}")

    # 生成 FFmpeg 命令
    if input_file and output_file:
        cmd_path = work_dir / "ffmpeg_cmd_fast.sh"
        generate_ffmpeg_cmd(input_file, filter_path, output_file, cmd_path)
        print(f"已生成: {cmd_path}")
        print(f"\n执行: bash {cmd_path}")


if __name__ == "__main__":
    main()

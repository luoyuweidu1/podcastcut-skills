#!/usr/bin/env python3
"""
粗剪脚本：从 transcript 出发，检查每个句子是否被标记删除

逻辑：
    遍历 transcript.json 每个句子
    → 检查句子文本是否出现在审查稿的 ~~删除标记~~ 中
    → 如果在，整句删除

用法：
    python rough_cut.py <工作目录> <输入音频> [输出音频]

示例：
    python rough_cut.py /path/to/project /path/to/input.mp3
    python rough_cut.py /path/to/project /path/to/input.mp3 /path/to/output.mp3
"""

import json
import re
import sys
from pathlib import Path


def normalize(text):
    """标准化文本：移除空格和标点"""
    text = re.sub(r'\s+', '', text)
    text = re.sub(r'[，。！？、：；""''（）【】《》\.,!?;:\'"()\[\]<>]', '', text)
    return text


def parse_review_deletions(review_path):
    """从审查稿提取所有 ~~...~~ 删除标记"""
    with open(review_path, 'r', encoding='utf-8') as f:
        content = f.read()

    pattern = r'~~([^~]+)~~'
    deletions = re.findall(pattern, content)

    # 标准化所有删除标记
    deletions_norm = [normalize(d) for d in deletions]
    # 合并成一个大字符串
    combined_norm = ''.join(deletions_norm)

    print(f"审查稿: {len(deletions)} 处删除标记")
    return deletions_norm, combined_norm


def find_deleted_sentences(sentences, deletions_norm, combined_norm):
    """遍历每个句子，检查是否需要删除"""
    to_delete = []

    for sent in sentences:
        text = sent['text']
        text_norm = normalize(text)

        if not text_norm:
            continue

        is_deleted = False

        # 单字符句子（如"好"）：要求精确匹配，避免误删
        if len(text_norm) == 1:
            for del_norm in deletions_norm:
                if text_norm == del_norm:
                    is_deleted = True
                    break
        else:
            # 多字符句子：检查是否在某个删除标记中
            for del_norm in deletions_norm:
                if text_norm in del_norm:
                    is_deleted = True
                    break

            if not is_deleted and text_norm in combined_norm:
                is_deleted = True

        if is_deleted:
            to_delete.append({
                'text': text,
                'start': sent['start'],
                'end': sent['end']
            })

    print(f"标记删除: {len(to_delete)} 个句子")
    return to_delete


def merge_deletions(deletions, gap=0.5):
    """合并连续的删除"""
    if not deletions:
        return []

    sorted_dels = sorted(deletions, key=lambda x: x['start'])
    merged = []
    current = {'start': sorted_dels[0]['start'], 'end': sorted_dels[0]['end']}

    for d in sorted_dels[1:]:
        if d['start'] - current['end'] < gap:
            current['end'] = max(current['end'], d['end'])
        else:
            merged.append(current)
            current = {'start': d['start'], 'end': d['end']}

    merged.append(current)
    print(f"合并后: {len(merged)} 个删除块")
    return merged


def calculate_keep_segments(delete_ranges, total_duration):
    """从删除范围计算保留片段"""
    if not delete_ranges:
        return [{'start': 0, 'end': total_duration}]

    sorted_dels = sorted(delete_ranges, key=lambda x: x['start'])
    keep = []
    pos = 0

    for d in sorted_dels:
        if d['start'] > pos:
            keep.append({'start': pos, 'end': d['start']})
        pos = max(pos, d['end'])

    if pos < total_duration:
        keep.append({'start': pos, 'end': total_duration})

    keep_dur = sum(s['end'] - s['start'] for s in keep)
    del_dur = total_duration - keep_dur

    print(f"保留: {len(keep)} 段, {keep_dur/60:.1f} 分钟")
    print(f"删除: {del_dur/60:.1f} 分钟")

    return keep


def generate_ffmpeg_filter(keep_segments, is_video=False):
    """生成 FFmpeg filter_complex 脚本"""
    lines = []
    labels = []

    for i, seg in enumerate(keep_segments):
        if is_video:
            lines.append(f"[0:v]trim=start={seg['start']:.3f}:end={seg['end']:.3f},setpts=PTS-STARTPTS[v{i}];")
            lines.append(f"[0:a]atrim=start={seg['start']:.3f}:end={seg['end']:.3f},asetpts=PTS-STARTPTS[a{i}];")
        else:
            lines.append(f"[0:a]atrim=start={seg['start']:.3f}:end={seg['end']:.3f},asetpts=PTS-STARTPTS[a{i}];")
            labels.append(f"[a{i}]")

    n = len(keep_segments)
    if is_video:
        concat = ''.join(f"[v{i}][a{i}]" for i in range(n))
        lines.append(f"{concat}concat=n={n}:v=1:a=1[outv][outa]")
    else:
        concat = ''.join(f"[a{i}]" for i in range(n))
        lines.append(f"{concat}concat=n={n}:v=0:a=1[outa]")

    return '\n'.join(lines)


def generate_ffmpeg_cmd(input_path, output_path, filter_path, is_video=False):
    """生成 FFmpeg 命令"""
    if is_video:
        return f'''#!/bin/bash
ffmpeg -y -i "{input_path}" \\
  -filter_complex_script "{filter_path}" \\
  -map "[outv]" -map "[outa]" \\
  -c:v libx264 -crf 18 -c:a aac \\
  "{output_path}"
'''
    else:
        return f'''#!/bin/bash
ffmpeg -y -i "{input_path}" \\
  -filter_complex_script "{filter_path}" \\
  -map "[outa]" \\
  -c:a libmp3lame -q:a 2 \\
  "{output_path}"
'''


def main():
    if len(sys.argv) < 3:
        print("用法: python rough_cut.py <工作目录> <输入音频> [输出音频]")
        print("示例: python rough_cut.py /path/to/project /path/to/input.mp3")
        sys.exit(1)

    work_dir = Path(sys.argv[1])
    input_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3]) if len(sys.argv) > 3 else work_dir / f"{input_path.stem}_v2{input_path.suffix}"

    is_video = input_path.suffix.lower() in ['.mp4', '.mov', '.mkv', '.avi']

    print("=" * 50)
    print("粗剪 - 从 transcript 匹配删除")
    print("=" * 50)

    # 1. 加载审查稿
    review_path = work_dir / "podcast_审查稿.md"
    if not review_path.exists():
        review_path = list(work_dir.glob("*审查稿*.md"))[0] if list(work_dir.glob("*审查稿*.md")) else None
    if not review_path:
        print("错误: 找不到审查稿")
        sys.exit(1)

    deletions_norm, combined_norm = parse_review_deletions(review_path)

    # 2. 加载 transcript
    json_path = work_dir / "podcast_transcript.json"
    if not json_path.exists():
        print(f"错误: 找不到 {json_path}")
        sys.exit(1)

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sentences = data['sentences']
    total_duration = data.get('duration', sentences[-1]['end'] if sentences else 0)
    print(f"Transcript: {len(sentences)} 句, {total_duration/60:.1f} 分钟")

    # 3. 匹配删除
    to_delete = find_deleted_sentences(sentences, deletions_norm, combined_norm)

    # 4. 合并连续删除
    merged = merge_deletions(to_delete)

    # 5. 计算保留片段
    keep_segments = calculate_keep_segments(merged, total_duration)

    # 6. 保存结果
    (work_dir / "podcast_删除清单.json").write_text(
        json.dumps({'deletions': merged, 'count': len(to_delete)}, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    (work_dir / "keep_segments.json").write_text(
        json.dumps({'segments': keep_segments, 'count': len(keep_segments)}, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    # 7. 生成 FFmpeg
    filter_content = generate_ffmpeg_filter(keep_segments, is_video)
    filter_path = work_dir / "filter.txt"
    filter_path.write_text(filter_content)

    cmd_content = generate_ffmpeg_cmd(input_path, output_path, filter_path, is_video)
    cmd_path = work_dir / "ffmpeg_cmd.sh"
    cmd_path.write_text(cmd_content)

    print("=" * 50)
    print(f"完成! 执行: bash {cmd_path}")
    print("=" * 50)


if __name__ == "__main__":
    main()

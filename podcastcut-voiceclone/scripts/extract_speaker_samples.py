#!/usr/bin/env python3
"""
提取说话人音频样本

从 podcast_transcript.json 中找到每个说话人连续说话最长的片段，
用 FFmpeg 提取 2-3 段各 15-20s 的音频样本，用于声音克隆。

Fish Audio 最佳做法：
- 2-3 段独立音频，每段 15-20s，单段不超过 30s
- 总时长 30-60s
- 自然段落式朗读，不要拼接碎片
- 说话人总说话时长 < 15s 的自动跳过

用法：
    python extract_speaker_samples.py <transcript.json> <音频文件> <输出目录> [最小时长]

示例：
    python extract_speaker_samples.py podcast_transcript.json 4-1.WAV ./samples
    python extract_speaker_samples.py podcast_transcript.json 4-1.WAV ./samples 10

输出：
    speaker_0_sample_1.wav, speaker_0_sample_2.wav, ...
"""
import json
import os
import subprocess
import sys


MIN_SPEAKER_DURATION = 15.0  # 说话人总时长低于此值则跳过
MAX_SEGMENT_DURATION = 30.0  # 单段最大时长
TARGET_SEGMENTS = 3          # 目标段数
MIN_SEGMENT_DURATION = 5.0   # 单段最小时长（太短的片段不要）


def find_solo_segments(sentences, spk_id):
    """找出指定说话人所有连续说话区间"""
    segments = []
    current_start = None
    current_end = None

    for s in sentences:
        if s['spk'] == spk_id:
            if current_start is None:
                current_start = s['start']
                current_end = s['end']
            else:
                current_end = s['end']
        else:
            if current_start is not None:
                duration = current_end - current_start
                segments.append({
                    'start': current_start,
                    'end': current_end,
                    'duration': duration
                })
                current_start = None
                current_end = None

    if current_start is not None:
        duration = current_end - current_start
        segments.append({
            'start': current_start,
            'end': current_end,
            'duration': duration
        })

    return segments


def select_best_segments(segments, target_count=3):
    """
    选择最佳的 2-3 段用于声音克隆。

    策略：
    - 过滤掉太短的片段（< 5s）
    - 按时长降序取前 target_count 段
    - 超过 30s 的截断到 30s
    """
    # 过滤太短的
    candidates = [s for s in segments if s['duration'] >= MIN_SEGMENT_DURATION]

    if not candidates:
        # 如果没有 >= 5s 的，放宽标准取所有 >= 3s 的
        candidates = [s for s in segments if s['duration'] >= 3.0]

    if not candidates:
        return []

    # 按时长降序
    candidates.sort(key=lambda x: x['duration'], reverse=True)

    # 取前 target_count 段
    selected = candidates[:target_count]

    # 截断超过 30s 的
    for seg in selected:
        if seg['duration'] > MAX_SEGMENT_DURATION:
            seg['end'] = seg['start'] + MAX_SEGMENT_DURATION
            seg['duration'] = MAX_SEGMENT_DURATION

    # 按时间顺序排序
    selected.sort(key=lambda x: x['start'])

    return selected


def extract_audio(audio_file, start, end, output_file):
    """用 FFmpeg 提取音频片段"""
    cmd = [
        'ffmpeg', '-y',
        '-i', audio_file,
        '-ss', str(start),
        '-to', str(end),
        '-acodec', 'pcm_s16le',
        '-ar', '44100',
        '-ac', '1',
        output_file
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def main():
    if len(sys.argv) < 4:
        print("用法: python extract_speaker_samples.py <transcript.json> <音频文件> <输出目录> [最小时长]")
        print("\n示例:")
        print("  python extract_speaker_samples.py podcast_transcript.json 4-1.WAV ./samples")
        print("\n说明:")
        print("  - 每个说话人输出 2-3 段独立音频（各 15-20s，≤30s）")
        print("  - 说话人总说话时长 < 15s 的自动跳过")
        sys.exit(1)

    transcript_file = sys.argv[1]
    audio_file = sys.argv[2]
    output_dir = sys.argv[3]
    min_duration = float(sys.argv[4]) if len(sys.argv) > 4 else MIN_SPEAKER_DURATION

    with open(transcript_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    sentences = data['sentences']

    speaker_ids = sorted(set(s['spk'] for s in sentences))
    print(f"发现 {len(speaker_ids)} 个说话人: {speaker_ids}")

    os.makedirs(output_dir, exist_ok=True)

    extracted_speakers = []
    skipped_speakers = []

    for spk_id in speaker_ids:
        all_segments = find_solo_segments(sentences, spk_id)
        total_duration = sum(s['duration'] for s in all_segments)

        print(f"\n说话人 {spk_id}: {len(all_segments)} 个连续片段，总时长 {total_duration:.1f}s")

        if total_duration < min_duration:
            print(f"  ⏭️  跳过（总时长 {total_duration:.1f}s < {min_duration}s）")
            skipped_speakers.append(spk_id)
            continue

        selected = select_best_segments(all_segments)

        if not selected:
            print(f"  ⏭️  跳过（没有足够长的连续片段）")
            skipped_speakers.append(spk_id)
            continue

        selected_total = sum(s['duration'] for s in selected)
        print(f"  ✅ 选中 {len(selected)} 段，总时长 {selected_total:.1f}s")

        for i, seg in enumerate(selected):
            output_file = os.path.join(output_dir, f"speaker_{spk_id}_sample_{i+1}.wav")
            print(f"     段 {i+1}: {seg['start']:.1f}s - {seg['end']:.1f}s ({seg['duration']:.1f}s)")
            extract_audio(audio_file, seg['start'], seg['end'], output_file)

        extracted_speakers.append(spk_id)

    print(f"\n{'='*40}")
    print(f"提取完成: {len(extracted_speakers)} 个说话人")
    if extracted_speakers:
        print(f"  已提取: {extracted_speakers}")
    if skipped_speakers:
        print(f"  已跳过: {skipped_speakers}")


if __name__ == '__main__':
    main()

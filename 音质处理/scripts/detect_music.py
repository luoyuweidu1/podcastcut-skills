#!/usr/bin/env python3
"""
检测音频中的音乐段 vs 人声段。

基于频谱特征（spectral flatness、harmonic ratio、onset density）
区分音乐和人声。主要用于保护音乐段不被 DeepFilterNet 误处理。

用法:
  python3 detect_music.py \
    --audio podcast.mp3 \
    --output music_segments.json

  # 使用用户手动标注（跳过自动检测）
  python3 detect_music.py \
    --manual "0-15.2,2845-2860.5" \
    --output music_segments.json
"""

import argparse
import json
import sys
import os

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# 分析参数
HOP_LENGTH = 512
FRAME_LENGTH = 2048
WINDOW_SECONDS = 3.0   # 滑动窗口大小（秒）
STEP_SECONDS = 1.0     # 滑动步长（秒）
MUSIC_THRESHOLD = 0.55  # 音乐概率阈值
MIN_MUSIC_DURATION = 3.0  # 最短音乐段（秒）
MERGE_GAP = 2.0         # 合并间隔（秒）


def analyze_music_probability(audio_path):
    """分析每个时间窗口是音乐的概率。"""
    import librosa
    import numpy as np

    print("   加载音频...")
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    duration = len(y) / sr
    print(f"   采样率: {sr}Hz, 时长: {int(duration//60)}:{int(duration%60):02d}")

    # 计算帧级特征
    print("   计算频谱特征...")
    spectral_flatness = librosa.feature.spectral_flatness(
        y=y, n_fft=FRAME_LENGTH, hop_length=HOP_LENGTH
    )[0]

    # harmonic/percussive 分离
    y_harmonic, y_percussive = librosa.effects.hpss(y)
    harmonic_energy = librosa.feature.rms(y=y_harmonic, hop_length=HOP_LENGTH)[0]
    total_energy = librosa.feature.rms(y=y, hop_length=HOP_LENGTH)[0]
    harmonic_ratio = np.where(total_energy > 1e-6, harmonic_energy / total_energy, 0)

    # onset 密度（音乐通常有更规律的 onset）
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

    # spectral bandwidth（音乐通常比人声宽）
    spectral_bw = librosa.feature.spectral_bandwidth(
        y=y, sr=sr, n_fft=FRAME_LENGTH, hop_length=HOP_LENGTH
    )[0]

    # 帧时间
    frame_times = librosa.frames_to_time(
        range(len(spectral_flatness)), sr=sr, hop_length=HOP_LENGTH
    )

    # 滑动窗口分析
    print("   滑动窗口分析...")
    window_frames = int(WINDOW_SECONDS * sr / HOP_LENGTH)
    step_frames = int(STEP_SECONDS * sr / HOP_LENGTH)

    results = []
    n_frames = len(spectral_flatness)

    for start_frame in range(0, n_frames - window_frames, step_frames):
        end_frame = start_frame + window_frames
        t_start = frame_times[start_frame]
        t_end = frame_times[min(end_frame, n_frames - 1)]

        # 窗口内特征统计
        win_flatness = np.mean(spectral_flatness[start_frame:end_frame])
        win_harmonic = np.mean(harmonic_ratio[start_frame:end_frame])
        win_onset = np.std(onset_env[start_frame:end_frame])  # onset 规律性
        win_bw = np.mean(spectral_bw[start_frame:end_frame])
        win_energy = np.mean(total_energy[start_frame:end_frame])

        # 综合评分
        # 音乐特征：较低的 spectral flatness（更有调性）、较高的 harmonic ratio、
        # 较宽的 bandwidth、较规律的 onset
        score = 0.0

        # spectral flatness: 音乐通常 < 0.1，人声通常 > 0.1
        if win_flatness < 0.05:
            score += 0.3
        elif win_flatness < 0.1:
            score += 0.15

        # harmonic ratio: 音乐通常 > 0.7
        if win_harmonic > 0.8:
            score += 0.3
        elif win_harmonic > 0.6:
            score += 0.15

        # bandwidth: 音乐通常更宽
        if win_bw > 2000:
            score += 0.2
        elif win_bw > 1500:
            score += 0.1

        # onset regularity: 音乐通常更规律（低 std）
        if win_onset < np.percentile(onset_env, 30):
            score += 0.2

        # 静音段不算音乐
        if win_energy < 0.001:
            score = 0.0

        results.append({
            'start': round(t_start, 2),
            'end': round(t_end, 2),
            'music_probability': round(score, 3),
            'features': {
                'spectral_flatness': round(float(win_flatness), 4),
                'harmonic_ratio': round(float(win_harmonic), 4),
                'bandwidth': round(float(win_bw), 1),
                'energy': round(float(win_energy), 6)
            }
        })

    return results, duration


def merge_music_segments(windows, threshold, min_duration, merge_gap):
    """将概率超过阈值的窗口合并为音乐段。"""
    # 筛选超过阈值的窗口
    music_windows = [w for w in windows if w['music_probability'] >= threshold]

    if not music_windows:
        return []

    # 合并相邻窗口
    segments = []
    current_start = music_windows[0]['start']
    current_end = music_windows[0]['end']
    max_prob = music_windows[0]['music_probability']

    for w in music_windows[1:]:
        if w['start'] - current_end <= merge_gap:
            current_end = w['end']
            max_prob = max(max_prob, w['music_probability'])
        else:
            if current_end - current_start >= min_duration:
                segments.append({
                    'start': current_start,
                    'end': current_end,
                    'confidence': max_prob,
                    'duration': round(current_end - current_start, 1)
                })
            current_start = w['start']
            current_end = w['end']
            max_prob = w['music_probability']

    # 最后一段
    if current_end - current_start >= min_duration:
        segments.append({
            'start': current_start,
            'end': current_end,
            'confidence': max_prob,
            'duration': round(current_end - current_start, 1)
        })

    return segments


def classify_segments(segments, total_duration):
    """给音乐段分类（片头/片尾/中间）。"""
    for seg in segments:
        if seg['start'] < 30:
            seg['type'] = 'intro_music'
        elif seg['end'] > total_duration - 30:
            seg['type'] = 'outro_music'
        else:
            seg['type'] = 'mid_music'
    return segments


def parse_manual_segments(manual_str):
    """解析手动标注的音乐段。格式: '0-15.2,2845-2860.5'"""
    segments = []
    for part in manual_str.split(','):
        part = part.strip()
        if '-' in part:
            start, end = part.split('-', 1)
            start = float(start.strip())
            end = float(end.strip())
            segments.append({
                'start': start,
                'end': end,
                'confidence': 1.0,
                'duration': round(end - start, 1),
                'type': 'manual'
            })
    return segments


def format_time(seconds):
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


def main():
    parser = argparse.ArgumentParser(description='检测音频中的音乐段')
    parser.add_argument('--audio', help='音频文件路径')
    parser.add_argument('--output', required=True, help='输出 JSON 路径')
    parser.add_argument('--manual', help='手动标注音乐段（格式: "0-15.2,2845-2860.5"）')
    parser.add_argument('--threshold', type=float, default=MUSIC_THRESHOLD,
                        help=f'音乐检测阈值（默认 {MUSIC_THRESHOLD}）')
    parser.add_argument('--min-duration', type=float, default=MIN_MUSIC_DURATION,
                        help=f'最短音乐段秒数（默认 {MIN_MUSIC_DURATION}）')
    args = parser.parse_args()

    # 手动模式
    if args.manual:
        segments = parse_manual_segments(args.manual)
        report = {
            'mode': 'manual',
            'music_segments': segments,
            'total_music_duration': round(sum(s['duration'] for s in segments), 1)
        }
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"✅ 手动标注已保存 → {args.output}")
        for seg in segments:
            print(f"   {format_time(seg['start'])}-{format_time(seg['end'])} ({seg['duration']}s)")
        return

    # 自动检测模式
    if not args.audio:
        print("❌ 自动检测模式需要 --audio 参数")
        sys.exit(1)

    print(f"🎵 开始音乐段检测: {args.audio}")

    windows, total_duration = analyze_music_probability(args.audio)
    segments = merge_music_segments(windows, args.threshold, args.min_duration, MERGE_GAP)
    segments = classify_segments(segments, total_duration)

    total_music_dur = sum(s['duration'] for s in segments)

    report = {
        'mode': 'auto',
        'audio_duration': round(total_duration, 1),
        'threshold': args.threshold,
        'music_segments': segments,
        'total_music_duration': round(total_music_dur, 1),
        'analysis_windows': len(windows)
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 音乐段检测完成 → {args.output}")
    if segments:
        print(f"   检测到 {len(segments)} 个音乐段，共 {format_time(total_music_dur)}:")
        for i, seg in enumerate(segments):
            print(f"   {i+1}. {format_time(seg['start'])}-{format_time(seg['end'])} "
                  f"({seg['duration']}s, {seg['type']}, 置信度 {seg['confidence']:.2f})")
    else:
        print("   未检测到音乐段")

    print("\n⚠️ 自动检测仅供参考，建议人工确认。如需手动标注:")
    print(f'   python3 detect_music.py --manual "0-15,2845-2860" --output {args.output}')


if __name__ == '__main__':
    main()

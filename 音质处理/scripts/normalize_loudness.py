#!/usr/bin/env python3
"""
按说话人增益补偿 + 全局响度标准化。

基于 analyze_loudness.py 的报告，按说话人段落应用不同增益，
然后整体标准化到目标 LUFS（默认 -16，播客标准）。

用法:
  python3 normalize_loudness.py \
    --audio audio_denoised.mp3 \
    --loudness-report loudness_report.json \
    --words subtitles_words.json \
    --speaker-mapping speaker_mapping.json \
    --output audio_final.mp3 \
    --bitrate 192k

  # 跳过按说话人补偿，只做全局标准化
  python3 normalize_loudness.py \
    --audio audio_denoised.mp3 \
    --target-lufs -16 \
    --output audio_final.mp3 \
    --global-only

  # 指定音乐段保护
  python3 normalize_loudness.py \
    --audio audio_denoised.mp3 \
    --loudness-report loudness_report.json \
    --words subtitles_words.json \
    --speaker-mapping speaker_mapping.json \
    --music-segments music_segments.json \
    --output audio_final.mp3
"""

import argparse
import json
import sys
import subprocess
import tempfile
import shutil
import os
from collections import defaultdict

import numpy as np
import soundfile as sf

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

MAX_GAIN_DB = 8.0      # 最大增益限制
CROSSFADE_MS = 30       # 说话人段落衔接 crossfade
TRUE_PEAK_LIMIT = -1.0  # dBTP limiter 上限


def load_speaker_segments(words_path, mapping_path):
    """从 subtitles_words.json 提取每个说话人的连续时间段。"""
    with open(words_path) as f:
        words = json.load(f)

    speaker_segments = defaultdict(list)
    current_speaker = None
    seg_start = None
    seg_end = None

    for w in words:
        if w.get('isGap') or w.get('isSpeakerLabel'):
            continue
        speaker = w.get('speaker')
        if not speaker:
            continue
        start = w.get('start', 0)
        end = w.get('end', 0)

        if speaker == current_speaker and seg_end is not None and start - seg_end < 0.5:
            seg_end = end
        else:
            if current_speaker and seg_start is not None:
                speaker_segments[current_speaker].append((seg_start, seg_end))
            current_speaker = speaker
            seg_start = start
            seg_end = end

    if current_speaker and seg_start is not None:
        speaker_segments[current_speaker].append((seg_start, seg_end))

    return dict(speaker_segments)


def decode_audio(audio_path, target_sr=48000):
    """解码音频为 WAV numpy array。"""
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    try:
        subprocess.run([
            'ffmpeg', '-i', audio_path, '-vn', '-acodec', 'pcm_s16le',
            '-ar', str(target_sr), '-ac', '1', '-y', tmp.name
        ], capture_output=True, check=True)
        data, sr = sf.read(tmp.name)
        return data, sr
    finally:
        os.unlink(tmp.name)


def db_to_linear(db):
    return 10.0 ** (db / 20.0)


def apply_gain_with_crossfade(audio, start_idx, end_idx, gain_linear, fade_samples):
    """对指定范围应用增益，边界做 crossfade 过渡。"""
    segment = audio[start_idx:end_idx].copy()
    segment *= gain_linear

    # 前 crossfade（从原始增益渐变到新增益）
    if fade_samples > 0 and start_idx > 0:
        fade_len = min(fade_samples, len(segment))
        fade_curve = np.linspace(0.0, 1.0, fade_len)
        original = audio[start_idx:start_idx + fade_len]
        gained = segment[:fade_len]
        segment[:fade_len] = original * (1.0 - fade_curve) + gained * fade_curve

    # 后 crossfade（从新增益渐变回原始增益）
    if fade_samples > 0 and end_idx < len(audio):
        fade_len = min(fade_samples, len(segment))
        fade_curve = np.linspace(1.0, 0.0, fade_len)
        offset = len(segment) - fade_len
        original = audio[end_idx - fade_len:end_idx]
        gained = segment[offset:]
        segment[offset:] = gained * fade_curve + original * (1.0 - fade_curve)

    audio[start_idx:end_idx] = segment
    return audio


def apply_limiter(audio, peak_db):
    """简单的 hard limiter，防止削波。"""
    peak_linear = db_to_linear(peak_db)
    peak_val = np.max(np.abs(audio))
    if peak_val > peak_linear:
        audio = audio * (peak_linear / peak_val)
    return audio


def encode_output(wav_data, sr, output_path, bitrate='192k'):
    """编码为 MP3。"""
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    try:
        sf.write(tmp.name, wav_data, sr)
        subprocess.run([
            'ffmpeg', '-i', tmp.name, '-c:a', 'libmp3lame',
            '-b:a', bitrate, '-y', output_path
        ], capture_output=True, check=True)
    finally:
        os.unlink(tmp.name)


def format_time(seconds):
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


def main():
    parser = argparse.ArgumentParser(description='按说话人增益补偿 + 全局响度标准化')
    parser.add_argument('--audio', required=True, help='输入音频路径')
    parser.add_argument('--loudness-report', help='loudness_report.json 路径')
    parser.add_argument('--words', help='subtitles_words.json 路径')
    parser.add_argument('--speaker-mapping', help='speaker_mapping.json 路径')
    parser.add_argument('--music-segments', help='music_segments.json 路径')
    parser.add_argument('--target-lufs', type=float, default=-16.0, help='目标 LUFS（默认 -16）')
    parser.add_argument('--output', required=True, help='输出音频路径')
    parser.add_argument('--bitrate', default='192k', help='输出码率（默认 192k）')
    parser.add_argument('--global-only', action='store_true', help='跳过按说话人补偿，只做全局标准化')
    args = parser.parse_args()

    print(f"🔊 开始响度标准化")
    print(f"   输入: {args.audio}")
    print(f"   目标: {args.target_lufs} LUFS")

    # 1. 解码音频
    print("   解码音频...")
    audio_data, sr = decode_audio(args.audio)
    fade_samples = int(CROSSFADE_MS / 1000.0 * sr)
    total_samples = len(audio_data)
    print(f"   采样率: {sr}Hz, 时长: {format_time(total_samples / sr)}")

    # 2. 按说话人增益补偿
    if not args.global_only and args.loudness_report and args.words and args.speaker_mapping:
        print("\n   📐 按说话人增益补偿...")

        with open(args.loudness_report) as f:
            loudness_report = json.load(f)

        speaker_segments = load_speaker_segments(args.words, args.speaker_mapping)

        # 加载音乐段（跳过）
        music_ranges = []
        if args.music_segments and os.path.exists(args.music_segments):
            with open(args.music_segments) as f:
                music_data = json.load(f)
            music_ranges = [(s['start'], s['end']) for s in music_data.get('music_segments', [])]

        def in_music_range(start, end):
            for ms, me in music_ranges:
                if start < me and end > ms:
                    return True
            return False

        speakers_info = loudness_report.get('speakers', {})
        adjusted_count = 0

        for speaker, info in speakers_info.items():
            boost_db = info.get('boost_db', 0)
            if abs(boost_db) < 0.5:  # 不到 0.5dB 就不调了
                print(f"   {speaker}: 偏差 {boost_db:+.1f} dB，无需调整")
                continue

            # 限制最大增益
            if abs(boost_db) > MAX_GAIN_DB:
                print(f"   ⚠️ {speaker}: 偏差 {boost_db:+.1f} dB 超过限制，裁剪到 {MAX_GAIN_DB:+.1f} dB")
                boost_db = MAX_GAIN_DB if boost_db > 0 else -MAX_GAIN_DB

            gain_linear = db_to_linear(boost_db)
            segments = speaker_segments.get(speaker, [])
            seg_count = 0

            for seg_start, seg_end in segments:
                if in_music_range(seg_start, seg_end):
                    continue
                s_idx = int(seg_start * sr)
                e_idx = int(seg_end * sr)
                s_idx = max(0, min(s_idx, total_samples))
                e_idx = max(0, min(e_idx, total_samples))
                if e_idx <= s_idx:
                    continue

                audio_data = apply_gain_with_crossfade(
                    audio_data, s_idx, e_idx, gain_linear, fade_samples
                )
                seg_count += 1

            print(f"   {speaker}: {boost_db:+.1f} dB 应用到 {seg_count} 段")
            adjusted_count += seg_count

        print(f"   共调整 {adjusted_count} 个段落")
    else:
        if not args.global_only:
            print("   ⚠️ 缺少 loudness-report/words/speaker-mapping，跳过按说话人补偿")

    # 3. 全局响度标准化
    print(f"\n   🌐 全局响度标准化 → {args.target_lufs} LUFS...")

    try:
        import pyloudnorm as pyln
        meter = pyln.Meter(sr)
        current_lufs = meter.integrated_loudness(audio_data)
        print(f"   当前整体 LUFS: {current_lufs:.1f}")

        if not np.isinf(current_lufs) and not np.isnan(current_lufs):
            # 使用 pyloudnorm 标准化
            audio_data = pyln.normalize.loudness(audio_data, current_lufs, args.target_lufs)
            print(f"   标准化增益: {args.target_lufs - current_lufs:+.1f} dB")
        else:
            print("   ⚠️ 无法测量 LUFS（可能音频太静），跳过全局标准化")
    except ImportError:
        print("   ⚠️ pyloudnorm 未安装，使用简单的 RMS 标准化")
        # fallback: 基于 RMS 的简单标准化
        rms = np.sqrt(np.mean(audio_data ** 2))
        if rms > 1e-6:
            # -16 LUFS ≈ -16.5 dBFS RMS（近似）
            target_rms = db_to_linear(-16.5)
            gain = target_rms / rms
            audio_data *= gain
            print(f"   RMS 标准化增益: {20 * np.log10(gain):+.1f} dB")

    # 4. Limiter
    print(f"   应用 limiter (peak {TRUE_PEAK_LIMIT} dBTP)...")
    audio_data = apply_limiter(audio_data, TRUE_PEAK_LIMIT)

    peak_db = 20 * np.log10(max(np.max(np.abs(audio_data)), 1e-10))
    print(f"   最终 peak: {peak_db:.1f} dBFS")

    # 5. 备份 + 输出
    if os.path.exists(args.output) and args.output != args.audio:
        backup_path = args.output.replace('.mp3', '_pre_normalize.mp3')
        if not os.path.exists(backup_path):
            shutil.copy2(args.output, backup_path)
            print(f"   📁 原文件已备份 → {backup_path}")

    print(f"   编码输出 ({args.bitrate})...")
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    encode_output(audio_data, sr, args.output, args.bitrate)

    # 6. 验证最终 LUFS
    try:
        import pyloudnorm as pyln
        final_data, final_sr = decode_audio(args.output)
        final_meter = pyln.Meter(final_sr)
        final_lufs = final_meter.integrated_loudness(final_data)
        print(f"\n   最终 LUFS: {final_lufs:.1f} (目标: {args.target_lufs})")
    except Exception:
        pass

    print(f"\n✅ 响度标准化完成 → {args.output}")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
按说话人段落运行 DeepFilterNet 降噪/去回声。

只处理指定说话人的段落，其他段落原样保留。
处理前后段落衔接处自动做 crossfade 过渡。

用法:
  python3 process_speaker.py \
    --audio podcast.mp3 \
    --words subtitles_words.json \
    --speaker-mapping speaker_mapping.json \
    --speakers "阿司" \
    --output audio_denoised.mp3 \
    --bitrate 192k

  # 处理多个说话人
  python3 process_speaker.py \
    --audio podcast.mp3 \
    --words subtitles_words.json \
    --speaker-mapping speaker_mapping.json \
    --speakers "阿司,雨林" \
    --output audio_denoised.mp3

  # 生成试听对比片段
  python3 process_speaker.py \
    --audio podcast.mp3 \
    --words subtitles_words.json \
    --speaker-mapping speaker_mapping.json \
    --speakers "阿司" \
    --preview-only \
    --preview-dir ./previews
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

CROSSFADE_MS = 50  # 衔接处 crossfade 毫秒数
MERGE_GAP_S = 0.5  # 间隔小于此值的段落合并处理


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

        if speaker == current_speaker and seg_end is not None and start - seg_end < MERGE_GAP_S:
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


def run_deepfilter(audio_segment, sr, tmp_dir):
    """对一段音频跑 DeepFilterNet，返回处理后的 numpy array。"""
    in_path = os.path.join(tmp_dir, 'segment_in.wav')
    out_dir = os.path.join(tmp_dir, 'df_out')
    os.makedirs(out_dir, exist_ok=True)

    sf.write(in_path, audio_segment, sr)

    result = subprocess.run(
        ['deepFilter', in_path, '-o', out_dir],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        print(f"   ⚠️ DeepFilterNet 错误: {result.stderr[:200]}")
        return audio_segment  # 失败时返回原音频

    # DeepFilterNet 输出文件名与输入同名
    out_path = os.path.join(out_dir, 'segment_in.wav')
    if not os.path.exists(out_path):
        # 有些版本输出到 out_dir 下的子目录
        for root, dirs, files in os.walk(out_dir):
            for f in files:
                if f.endswith('.wav'):
                    out_path = os.path.join(root, f)
                    break

    if os.path.exists(out_path):
        processed, _ = sf.read(out_path)
        return processed
    else:
        print(f"   ⚠️ 找不到 DeepFilterNet 输出文件")
        return audio_segment


def apply_crossfade(original, processed, seg_start_idx, seg_end_idx, fade_samples):
    """在处理段和原始段的衔接处做 crossfade。"""
    result = original.copy()

    # 确保长度匹配（DeepFilterNet 可能微调长度）
    seg_len = seg_end_idx - seg_start_idx
    if len(processed) > seg_len:
        processed = processed[:seg_len]
    elif len(processed) < seg_len:
        pad = np.zeros(seg_len - len(processed))
        processed = np.concatenate([processed, pad])

    # 写入处理后的段落
    result[seg_start_idx:seg_end_idx] = processed

    # 前衔接 crossfade（原始淡出 → 处理后淡入）
    fade_in_start = max(0, seg_start_idx)
    fade_in_end = min(seg_start_idx + fade_samples, seg_end_idx)
    fade_len = fade_in_end - fade_in_start
    if fade_len > 0:
        fade_curve = np.linspace(0.0, 1.0, fade_len)
        result[fade_in_start:fade_in_end] = (
            original[fade_in_start:fade_in_end] * (1.0 - fade_curve) +
            processed[:fade_len] * fade_curve
        )

    # 后衔接 crossfade（处理后淡出 → 原始淡入）
    fade_out_start = max(seg_start_idx, seg_end_idx - fade_samples)
    fade_out_end = seg_end_idx
    fade_len = fade_out_end - fade_out_start
    if fade_len > 0:
        fade_curve = np.linspace(1.0, 0.0, fade_len)
        offset = fade_out_start - seg_start_idx
        result[fade_out_start:fade_out_end] = (
            processed[offset:offset + fade_len] * fade_curve +
            original[fade_out_start:fade_out_end] * (1.0 - fade_curve)
        )

    return result


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
    parser = argparse.ArgumentParser(description='按说话人降噪/去回声')
    parser.add_argument('--audio', required=True, help='音频文件路径')
    parser.add_argument('--words', required=True, help='subtitles_words.json 路径')
    parser.add_argument('--speaker-mapping', required=True, help='speaker_mapping.json 路径')
    parser.add_argument('--speakers', required=True, help='要处理的说话人（逗号分隔）')
    parser.add_argument('--music-segments', help='music_segments.json 路径（跳过音乐段）')
    parser.add_argument('--output', help='输出音频路径')
    parser.add_argument('--bitrate', default='192k', help='输出码率（默认 192k）')
    parser.add_argument('--preview-only', action='store_true', help='只生成试听对比片段')
    parser.add_argument('--preview-dir', default='./previews', help='试听片段输出目录')
    parser.add_argument('--preview-count', type=int, default=3, help='试听片段数量')
    parser.add_argument('--preview-duration', type=float, default=15.0, help='每段试听时长（秒）')
    args = parser.parse_args()

    target_speakers = [s.strip() for s in args.speakers.split(',')]
    print(f"🎙️ 开始按说话人音质处理")
    print(f"   音频: {args.audio}")
    print(f"   目标说话人: {', '.join(target_speakers)}")

    # 1. 解码音频
    print("   解码音频...")
    audio_data, sr = decode_audio(args.audio)
    total_samples = len(audio_data)
    fade_samples = int(CROSSFADE_MS / 1000.0 * sr)
    print(f"   采样率: {sr}Hz, 时长: {format_time(total_samples / sr)}")

    # 2. 加载说话人段落
    all_segments = load_speaker_segments(args.words, args.speaker_mapping)

    # 3. 加载音乐段（如有），跳过音乐段内的说话人段落
    music_ranges = []
    if args.music_segments and os.path.exists(args.music_segments):
        with open(args.music_segments) as f:
            music_data = json.load(f)
        music_ranges = [(s['start'], s['end']) for s in music_data.get('music_segments', [])]
        if music_ranges:
            print(f"   已加载 {len(music_ranges)} 个音乐段，处理时将跳过")

    def in_music_range(start, end):
        for ms, me in music_ranges:
            if start < me and end > ms:
                return True
        return False

    # 4. 收集要处理的段落
    segments_to_process = []
    for speaker in target_speakers:
        if speaker not in all_segments:
            print(f"   ⚠️ 说话人 '{speaker}' 未找到，跳过")
            continue
        for seg_start, seg_end in all_segments[speaker]:
            if in_music_range(seg_start, seg_end):
                continue
            if seg_end - seg_start < 0.3:  # 太短的段落跳过
                continue
            segments_to_process.append((seg_start, seg_end, speaker))

    segments_to_process.sort(key=lambda x: x[0])
    total_process_dur = sum(e - s for s, e, _ in segments_to_process)
    print(f"   共 {len(segments_to_process)} 段需要处理，总计 {format_time(total_process_dur)}")

    if not segments_to_process:
        print("   没有需要处理的段落，退出")
        return

    # 5. 如果只要试听对比
    if args.preview_only:
        print(f"\n📢 生成试听对比片段...")
        os.makedirs(args.preview_dir, exist_ok=True)

        # 均匀选取 preview_count 个段落
        step = max(1, len(segments_to_process) // (args.preview_count + 1))
        preview_indices = [step * (i + 1) for i in range(args.preview_count)]
        preview_indices = [i for i in preview_indices if i < len(segments_to_process)]

        tmp_dir = tempfile.mkdtemp()
        try:
            for idx, pi in enumerate(preview_indices):
                seg_start, seg_end, speaker = segments_to_process[pi]
                # 扩展到 preview_duration 秒
                center = (seg_start + seg_end) / 2
                half_dur = args.preview_duration / 2
                clip_start = max(0, center - half_dur)
                clip_end = min(total_samples / sr, center + half_dur)

                s_idx = int(clip_start * sr)
                e_idx = int(clip_end * sr)
                clip_data = audio_data[s_idx:e_idx]

                # 原版
                before_path = os.path.join(args.preview_dir, f'preview_before_{idx+1}.mp3')
                encode_output(clip_data, sr, before_path, args.bitrate)

                # DeepFilterNet 处理版
                processed_clip = run_deepfilter(clip_data, sr, tmp_dir)
                after_path = os.path.join(args.preview_dir, f'preview_after_{idx+1}.mp3')
                encode_output(processed_clip, sr, after_path, args.bitrate)

                print(f"   片段 {idx+1}: {format_time(clip_start)}-{format_time(clip_end)} ({speaker})")
                print(f"      处理前: {before_path}")
                print(f"      处理后: {after_path}")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        print(f"\n✅ 试听对比片段已生成 → {args.preview_dir}")
        return

    # 6. 完整处理
    if not args.output:
        print("❌ 完整处理模式需要 --output 参数")
        sys.exit(1)

    print(f"\n🔧 开始 DeepFilterNet 处理...")
    result_audio = audio_data.copy()
    tmp_dir = tempfile.mkdtemp()

    try:
        for i, (seg_start, seg_end, speaker) in enumerate(segments_to_process):
            s_idx = int(seg_start * sr)
            e_idx = int(seg_end * sr)
            s_idx = max(0, min(s_idx, total_samples))
            e_idx = max(0, min(e_idx, total_samples))

            segment = audio_data[s_idx:e_idx]
            dur = seg_end - seg_start

            progress = f"[{i+1}/{len(segments_to_process)}]"
            print(f"   {progress} {speaker} {format_time(seg_start)}-{format_time(seg_end)} ({dur:.1f}s)")

            processed = run_deepfilter(segment, sr, tmp_dir)
            result_audio = apply_crossfade(result_audio, processed, s_idx, e_idx, fade_samples)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # 7. 备份原文件 + 输出
    if os.path.exists(args.output):
        backup_path = args.output.replace('.mp3', '_pre_denoise.mp3')
        if not os.path.exists(backup_path):
            shutil.copy2(args.output, backup_path)
            print(f"   📁 原文件已备份 → {backup_path}")

    print(f"   编码输出 ({args.bitrate})...")
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    encode_output(result_audio, sr, args.output, args.bitrate)

    print(f"\n✅ 音质处理完成 → {args.output}")
    print(f"   处理了 {len(segments_to_process)} 段，共 {format_time(total_process_dur)}")


if __name__ == '__main__':
    main()

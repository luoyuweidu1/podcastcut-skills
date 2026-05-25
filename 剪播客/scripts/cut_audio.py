#!/usr/bin/env python3
"""
步骤8: 一键剪辑生成精剪版

用法: python3 cut_audio.py [output_name.mp3] [audio_file] [delete_segments.json]
      python3 cut_audio.py [output_name.mp3] [audio_file] [delete_segments.json] --speakers-json subtitles_words.json
默认:
  - output_name: 播客_精剪版_v1.mp3
  - audio_file: 自动检测 ../1_转录/audio_original.*（⚠️ 禁止用 audio.mp3）
  - delete_segments: delete_segments.json

v4: 可选说话人音量对齐 — 检测各说话人平均响度，补偿音量差异（最大 +6dB）。
v3: 自适应淡入淡出 — 每个切点根据片段时长自动加 fade，消除断句感。
v2: 先解码为 WAV 再切割，确保采样级精确（MP3 -c copy 只有帧级精度 ~26ms）。
"""

import json
import subprocess
import sys
import os
import re
from collections import defaultdict

# 确保 print 实时输出（通过管道运行时默认是全缓冲）
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)


def calc_fade_duration(segment_duration):
    """
    自适应淡入淡出时长，和片段长度挂钩。

    规则：
    - 极短片段 (< 0.3s): 不加 fade（太短会失真）
    - 短片段 (0.3-2s):  fade = 段长 × 8%，最少 0.03s
    - 中片段 (2-8s):    fade = 0.15 ~ 0.25s
    - 长片段 (> 8s):    fade = 0.3s（上限）
    """
    if segment_duration < 0.3:
        return 0.0
    fade = min(segment_duration * 0.08, 0.3)
    return max(fade, 0.03)


MAX_GAIN_DB = 6.0  # 最大增益限制，防止过度放大噪声


def load_speaker_segments(speakers_json_path):
    """
    从 subtitles_words.json 提取每个说话人的时间段列表。

    subtitles_words.json 格式：
    [
      {"text": "[麦雅]", "start": 69.4, "end": 69.4, "isSpeakerLabel": true, "speaker": "麦雅"},
      {"text": "大家", "start": 69.5, "end": 69.7, "speaker": "麦雅"},
      {"text": "", "start": 70.5, "end": 71.2, "isGap": true},
      ...
    ]

    返回: {speaker_name: [(start, end), ...]} — 每个说话人的连续语音时间段
    """
    with open(speakers_json_path) as f:
        words = json.load(f)

    # 按说话人分组连续词，合并为时间段
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

        if speaker == current_speaker and seg_end is not None and start - seg_end < 1.0:
            # 同一说话人，间隙 < 1s，延续当前段
            seg_end = end
        else:
            # 新说话人或间隙过大，保存上一段，开始新段
            if current_speaker and seg_start is not None:
                speaker_segments[current_speaker].append((seg_start, seg_end))
            current_speaker = speaker
            seg_start = start
            seg_end = end

    # 保存最后一段
    if current_speaker and seg_start is not None:
        speaker_segments[current_speaker].append((seg_start, seg_end))

    return dict(speaker_segments)


def detect_speaker_loudness(wav_file, speaker_segments):
    """
    用 ffmpeg volumedetect 检测每个说话人的平均音量 (mean_volume dB)。

    对每个说话人，采样最多 30 个时间段（避免超长播客耗时过久），
    用 ffmpeg 提取片段并测量 mean_volume。

    返回: {speaker_name: mean_volume_dB}
    """
    speaker_loudness = {}

    for speaker, segments in speaker_segments.items():
        # 采样：取最多 30 段，均匀分布
        if len(segments) > 30:
            step = len(segments) / 30
            sampled = [segments[int(i * step)] for i in range(30)]
        else:
            sampled = segments

        # 过滤掉太短的段（< 0.3s），测量不准
        sampled = [(s, e) for s, e in sampled if e - s >= 0.3]

        if not sampled:
            continue

        # 将多段拼成一个 ffmpeg 滤镜表达式，一次调用完成
        # 用 aselect 选择多个时间范围，再 volumedetect
        select_parts = []
        for s, e in sampled:
            select_parts.append(f'between(t,{s:.3f},{e:.3f})')

        select_expr = '+'.join(select_parts)
        af = f"aselect='{select_expr}',aresample=async=1,volumedetect"

        cmd = [
            'ffmpeg', '-v', 'info',
            '-i', wav_file,
            '-af', af,
            '-f', 'null', '-'
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        stderr = result.stderr

        # 解析 mean_volume
        match = re.search(r'mean_volume:\s*([-\d.]+)\s*dB', stderr)
        if match:
            speaker_loudness[speaker] = float(match.group(1))

    return speaker_loudness


def calc_volume_compensation(speaker_loudness):
    """
    以最响的说话人为基准（0dB 补偿），计算其他人需要增加的 dB 值。
    限制最大增益为 MAX_GAIN_DB。

    返回: {speaker_name: gain_dB}
    """
    if not speaker_loudness:
        return {}

    max_vol = max(speaker_loudness.values())
    compensation = {}

    for speaker, vol in speaker_loudness.items():
        gain = max_vol - vol  # 正值 = 需要增益
        gain = min(gain, MAX_GAIN_DB)
        # 低于 0.5dB 的差异忽略（听感上无区别）
        compensation[speaker] = round(gain, 2) if gain >= 0.5 else 0.0

    return compensation


def get_segment_speaker(seg_start, seg_end, speaker_segments):
    """
    确定一个保留片段主要属于哪个说话人。

    方法：计算每个说话人在此时间段内的重叠时长，取最长者。
    """
    best_speaker = None
    best_overlap = 0

    for speaker, segments in speaker_segments.items():
        overlap = 0
        for s, e in segments:
            # 计算重叠
            ov_start = max(seg_start, s)
            ov_end = min(seg_end, e)
            if ov_end > ov_start:
                overlap += ov_end - ov_start

        if overlap > best_overlap:
            best_overlap = overlap
            best_speaker = speaker

    return best_speaker


def main():
    # 参数解析：支持位置参数 + --speakers-json / --no-fade 可选参数
    positional_args = []
    speakers_json = None
    no_fade = False

    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == '--speakers-json':
            if i + 1 < len(sys.argv):
                speakers_json = sys.argv[i + 1]
                i += 2
            else:
                print("--speakers-json 需要指定文件路径")
                sys.exit(1)
        elif sys.argv[i] == '--no-fade':
            no_fade = True
            i += 1
        else:
            positional_args.append(sys.argv[i])
            i += 1

    output_name = positional_args[0] if len(positional_args) > 0 else '播客_精剪版_v1.mp3'
    delete_file = positional_args[2] if len(positional_args) > 2 else 'delete_segments.json'

    # 音频文件：优先使用 audio_original.*（高质量原始音频）
    if len(positional_args) > 1:
        audio_file = positional_args[1]
    else:
        import glob
        originals = glob.glob('../1_转录/audio_original.*')
        if originals:
            audio_file = originals[0]
            print(f"🎵 自动检测到原始音频: {audio_file}")
        else:
            audio_file = '../1_转录/audio.mp3'
            print("⚠️ 未找到 audio_original.*，回退到 audio.mp3（音质会降低）")

    # 检查文件
    if not os.path.exists(audio_file):
        print(f"找不到音频文件: {audio_file}")
        sys.exit(1)

    # 安全检查：禁止在 audio_original.* 存在时使用 audio.mp3
    audio_dir = os.path.dirname(os.path.abspath(audio_file))
    audio_base = os.path.basename(audio_file)
    if audio_base == 'audio.mp3':
        originals_in_dir = [f for f in os.listdir(audio_dir) if f.startswith('audio_original.')]
        if originals_in_dir:
            print(f"❌ 错误: 检测到 {originals_in_dir[0]}，请使用原始音频而非 audio.mp3（16kHz 降采样版）")
            print(f"   建议: 将第二个参数改为 1_转录/{originals_in_dir[0]}")
            sys.exit(1)

    if not os.path.exists(delete_file):
        print(f"找不到删除片段文件: {delete_file}")
        sys.exit(1)

    if speakers_json and not os.path.exists(speakers_json):
        print(f"找不到说话人数据文件: {speakers_json}")
        sys.exit(1)

    # 读取删除片段（支持新格式 {segments: [...], editState: {...}} 和旧格式 [...]）
    with open(delete_file) as f:
        raw = json.load(f)
    delete_segs = raw['segments'] if isinstance(raw, dict) and 'segments' in raw else raw

    # 生成保留片段
    keep_segs = []
    last_end = 0

    for seg in delete_segs:
        if seg['start'] > last_end:
            keep_segs.append((last_end, seg['start']))
        last_end = seg['end']

    # 获取音频总时长
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries',
         'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
         audio_file],
        capture_output=True, text=True
    )
    total_duration = float(result.stdout.strip())

    if last_end < total_duration:
        keep_segs.append((last_end, total_duration))

    print(f"📊 剪辑统计:")
    print(f"   保留片段数: {len(keep_segs)}")
    print(f"   删除片段数: {len(delete_segs)}")
    print(f"   原始时长: {int(total_duration // 60)}分{int(total_duration % 60)}秒")
    print("")

    # 解码为 WAV（采样级精确切割，MP3 -c copy 只有帧级精度 ~26ms）
    temp_wav = '_source_temp.wav'
    print("🔊 解码为 WAV（确保采样级精确切割）...")
    cmd = [
        'ffmpeg', '-v', 'quiet', '-stats',
        '-i', audio_file,
        '-c:a', 'pcm_s16le',
        '-y', temp_wav
    ]
    subprocess.run(cmd, check=True)
    wav_size_mb = os.path.getsize(temp_wav) / (1024 * 1024)
    print(f"   WAV 临时文件: {wav_size_mb:.0f}MB")
    print("")

    # 说话人音量对齐（可选）
    speaker_compensation = {}
    speaker_segments_data = {}
    if speakers_json:
        print("🎙️ 分析说话人音量...")
        speaker_segments_data = load_speaker_segments(speakers_json)
        print(f"   检测到 {len(speaker_segments_data)} 个说话人: {', '.join(speaker_segments_data.keys())}")

        speaker_loudness = detect_speaker_loudness(temp_wav, speaker_segments_data)
        for spk, vol in speaker_loudness.items():
            print(f"   {spk}: 平均音量 {vol:.1f} dB")

        speaker_compensation = calc_volume_compensation(speaker_loudness)
        any_compensation = any(g > 0 for g in speaker_compensation.values())

        if any_compensation:
            print("   音量补偿方案:")
            for spk, gain in speaker_compensation.items():
                if gain > 0:
                    print(f"     {spk}: +{gain:.1f} dB")
                else:
                    print(f"     {spk}: 基准（无补偿）")
        else:
            print("   各说话人音量差异 < 0.5dB，无需补偿")
        print("")

    # 从 WAV 提取保留片段
    has_vol = speaker_compensation and any(g > 0 for g in speaker_compensation.values())
    if no_fade:
        print(f"🎬 提取保留片段（无淡入淡出{' + 说话人音量对齐' if has_vol else ''}）...")
    elif has_vol:
        print("🎬 提取保留片段（带自适应淡入淡出 + 说话人音量对齐）...")
    else:
        print("🎬 提取保留片段（带自适应淡入淡出）...")
    segment_files = []
    fade_count = 0

    for i, (start, end) in enumerate(keep_segs):
        seg_dur = end - start
        output = f'segment_{i:04d}.wav'

        is_first = (i == 0)
        is_last = (i == len(keep_segs) - 1)

        if no_fade:
            # 微 fade 3ms：防止波形不连续的 click，但不影响语音
            fade_in_dur = 0.0 if is_first else 0.003
            fade_out_dur = 0.0 if is_last else 0.003
        else:
            fade_in_dur = 0.0 if is_first else calc_fade_duration(seg_dur)
            fade_out_dur = 0.0 if is_last else calc_fade_duration(seg_dur)

        # 安全检查：淡入 + 淡出不能超过片段总长的 60%
        if fade_in_dur + fade_out_dur > seg_dur * 0.6:
            ratio = (seg_dur * 0.6) / (fade_in_dur + fade_out_dur)
            fade_in_dur *= ratio
            fade_out_dur *= ratio

        # 确定此片段的说话人音量补偿
        vol_gain = 0.0
        if speaker_compensation and speaker_segments_data:
            seg_speaker = get_segment_speaker(start, end, speaker_segments_data)
            if seg_speaker:
                vol_gain = speaker_compensation.get(seg_speaker, 0.0)

        needs_fade = fade_in_dur > 0 or fade_out_dur > 0
        needs_filter = needs_fade or vol_gain > 0

        if needs_filter:
            # 构建滤镜链
            filters = []
            if vol_gain > 0:
                filters.append(f'volume={vol_gain:.2f}dB')
            if fade_in_dur > 0:
                filters.append(f'afade=t=in:d={fade_in_dur:.3f}')
            if fade_out_dur > 0:
                fade_out_start = seg_dur - fade_out_dur
                filters.append(f'afade=t=out:st={fade_out_start:.3f}:d={fade_out_dur:.3f}')

            cmd = [
                'ffmpeg', '-v', 'quiet',
                '-ss', str(start),
                '-i', temp_wav,
                '-t', str(seg_dur),
                '-af', ','.join(filters),
                '-y', output
            ]
            if needs_fade:
                fade_count += 1
        else:
            # 直接复制（无需 fade 也无需音量补偿的首尾段或极短段）
            cmd = [
                'ffmpeg', '-v', 'quiet',
                '-i', temp_wav,
                '-ss', str(start),
                '-to', str(end),
                '-c', 'copy',
                '-y', output
            ]

        subprocess.run(cmd, check=True)
        segment_files.append(output)

        if (i + 1) % 50 == 0:
            print(f"   已提取 {i+1}/{len(keep_segs)} 个片段")

    print(f"✅ 已提取所有 {len(keep_segs)} 个片段，{fade_count} 个切点加了淡入淡出")
    print("")

    # 合并 WAV 片段
    print("🔗 合并片段...")
    concat_file = 'concat_list.txt'
    with open(concat_file, 'w') as f:
        for seg_file in segment_files:
            f.write(f"file '{seg_file}'\n")

    temp_concat = '_concat_temp.wav'
    cmd = [
        'ffmpeg', '-v', 'quiet', '-stats',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_file,
        '-c', 'copy',
        '-y', temp_concat
    ]
    subprocess.run(cmd, check=True)

    # 探测源文件编码参数，匹配输出质量
    probe_result = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'a:0',
         '-show_entries', 'stream=bit_rate,sample_rate,channels',
         '-of', 'default=noprint_wrappers=1', audio_file],
        capture_output=True, text=True
    )
    src_bitrate = 128000  # default
    src_sample_rate = None
    src_channels = None
    for line in probe_result.stdout.strip().split('\n'):
        if line.startswith('bit_rate=') and line.split('=')[1].strip().isdigit():
            src_bitrate = int(line.split('=')[1].strip())
        elif line.startswith('sample_rate=') and line.split('=')[1].strip().isdigit():
            src_sample_rate = int(line.split('=')[1].strip())
        elif line.startswith('channels=') and line.split('=')[1].strip().isdigit():
            src_channels = int(line.split('=')[1].strip())

    # MP3 bitrate: at least 128k, cap at 192k
    out_bitrate = max(src_bitrate // 1000, 128)
    out_bitrate = min(out_bitrate, 192)
    print(f"🔧 编码为 MP3 (源: {src_bitrate//1000}kbps {src_sample_rate}Hz {src_channels}ch → 输出: {out_bitrate}kbps)...")

    cmd = [
        'ffmpeg', '-v', 'quiet', '-stats',
        '-i', temp_concat,
        '-c:a', 'libmp3lame', '-b:a', f'{out_bitrate}k',
    ]
    if src_sample_rate and src_sample_rate > 16000:
        cmd.extend(['-ar', str(src_sample_rate)])
    if src_channels and src_channels > 1:
        cmd.extend(['-ac', str(src_channels)])
    cmd.extend(['-y', output_name])
    subprocess.run(cmd, check=True)

    # 清理临时文件
    os.remove(temp_wav)
    os.remove(temp_concat)
    for seg_file in segment_files:
        os.remove(seg_file)
    os.remove(concat_file)

    print("")
    print(f"✅ 剪辑完成: {output_name}")
    print("")

    # 显示统计信息
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries',
         'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
         output_name],
        capture_output=True, text=True
    )
    final_duration = float(result.stdout.strip())

    original_min = int(total_duration // 60)
    final_min = int(final_duration // 60)
    saved_min = original_min - final_min

    print("📈 剪辑效果:")
    print(f"   原始时长: {original_min}分钟")
    print(f"   精剪时长: {final_min}分钟")
    print(f"   节省时间: {saved_min}分钟 ({saved_min/original_min*100:.1f}%)")


if __name__ == '__main__':
    main()

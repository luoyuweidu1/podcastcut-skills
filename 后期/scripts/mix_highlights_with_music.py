#!/usr/bin/env python3
"""
金句片段 + 背景音乐混合脚本

将高亮片段叠加在连续背景音乐上，人声出现时音乐自动降低。
解决问题：金句没有背景音乐听起来突兀。

用法:
  python3 mix_highlights_with_music.py \
    --theme theme_song.mp3 \
    --clips clip1.mp3 clip2.mp3 clip3.mp3 \
    --output intro_complete.wav \
    [--intro-dur 10]       片头纯音乐时长（默认10s）
    [--gap-dur 5]          片段间过渡时长（默认5s）
    [--outro-dur 9]        尾声过渡到正文时长（默认9s）
    [--music-vol 0.16]     人声时背景音乐音量（默认0.16=约8%听感）
    [--voice-gain 2.0]     人声增益倍数（默认2.0）
    [--fade-transition 1.5] 音乐升降渐变时长（默认1.5s）

输出:
  intro_complete.wav - 完整片头（连续音乐 + 人声叠加）

原理:
  1. 计算总时长和各时间点
  2. 创建连续背景音乐轨（volume expression 动态调音量）
  3. 逐个叠加人声（amerge+pan，不用 amix！）
  4. 混合音乐轨 + 人声轨
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile


def get_duration(filepath):
    """获取音频时长"""
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries',
         'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
         filepath],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())


def check_volume(filepath):
    """检查音频音量，返回 max_volume (dB)"""
    result = subprocess.run(
        ['ffmpeg', '-i', filepath, '-af', 'volumedetect', '-f', 'null', '-'],
        capture_output=True, text=True
    )
    for line in result.stderr.split('\n'):
        if 'max_volume' in line:
            val = line.split('max_volume:')[1].strip().split(' ')[0]
            return float(val)
    return -999


def build_volume_expression(timeline, music_vol, fade_dur):
    """
    构建 volume=eval=frame 的动态音量表达式。

    timeline: [(start, end, vol), ...] 各时段的目标音量
    music_vol: 人声时的背景音量 (0-1)
    fade_dur: 音量渐变时长 (秒)
    """
    # 排序时间线
    timeline.sort(key=lambda x: x[0])

    # 构建 if-else 嵌套表达式
    parts = []
    for i, (start, end, vol) in enumerate(timeline):
        if i == 0 and start > 0:
            # 片头区域（start 之前）
            parts.append(f"if(lt(t,{start:.3f}),1.0,")

        if vol < 1.0:
            # 人声区域：渐入到低音量
            fade_in_end = start + fade_dur
            fade_out_start = end
            fade_out_end = end + fade_dur

            # 渐入低音量
            parts.append(
                f"if(lt(t,{fade_in_end:.3f}),"
                f"1.0-(t-{start:.3f})/{fade_dur:.3f}*(1.0-{music_vol}),"
            )
            # 保持低音量
            parts.append(
                f"if(lt(t,{fade_out_start:.3f}),{music_vol},"
            )
            # 渐出恢复
            parts.append(
                f"if(lt(t,{fade_out_end:.3f}),"
                f"{music_vol}+(t-{fade_out_start:.3f})/{fade_dur:.3f}*(1.0-{music_vol}),"
            )
        else:
            parts.append(f"if(lt(t,{end:.3f}),1.0,")

    # 最后一段
    parts.append("1.0")
    # 关闭所有括号
    parts.append(")" * (len(parts) - 1))

    return "".join(parts)


def main():
    parser = argparse.ArgumentParser(description='金句片段 + 背景音乐混合')
    parser.add_argument('--theme', required=True, help='主题曲文件路径')
    parser.add_argument('--clips', nargs='+', required=True, help='高亮片段文件路径列表')
    parser.add_argument('--output', default='intro_complete.wav', help='输出文件路径')
    parser.add_argument('--intro-dur', type=float, default=10, help='片头纯音乐时长(s)')
    parser.add_argument('--gap-dur', type=float, default=5, help='片段间过渡时长(s)')
    parser.add_argument('--outro-dur', type=float, default=9, help='尾声过渡到正文时长(s)')
    parser.add_argument('--music-vol', type=float, default=0.08, help='人声时背景音乐音量(0-1)')
    parser.add_argument('--voice-gain', type=float, default=2.0, help='人声增益倍数')
    parser.add_argument('--fade-transition', type=float, default=1.5, help='音乐升降渐变时长(s)')
    parser.add_argument('--theme-start', type=float, default=0, help='主题曲截取起点(s)')

    args = parser.parse_args()

    # 检查文件
    if not os.path.exists(args.theme):
        print(f"❌ 找不到主题曲: {args.theme}")
        sys.exit(1)
    for clip in args.clips:
        if not os.path.exists(clip):
            print(f"❌ 找不到片段: {clip}")
            sys.exit(1)

    # 获取各片段时长
    clip_durations = []
    for clip in args.clips:
        dur = get_duration(clip)
        clip_durations.append(dur)
        print(f"   片段: {os.path.basename(clip)} ({dur:.1f}s)")

    # 计算时间线
    # 结构: [片头音乐] [片段1+低音乐] [过渡] [片段2+低音乐] [过渡] ... [尾声渐出]
    timeline = []  # (start_of_voice, end_of_voice, target_vol)
    cursor = args.intro_dur

    clip_positions = []  # 每个片段在时间轴上的位置 (ms)
    for i, dur in enumerate(clip_durations):
        clip_start = cursor
        clip_end = cursor + dur
        clip_positions.append(clip_start)

        # 人声区域：音乐降低（从渐变开始到渐变结束）
        timeline.append((clip_start - args.fade_transition, clip_end, args.music_vol))

        cursor = clip_end + args.gap_dur

    total_dur = cursor - args.gap_dur + args.outro_dur
    theme_dur = get_duration(args.theme)

    print(f"\n📊 时间线:")
    print(f"   片头音乐: 0 ~ {args.intro_dur:.1f}s")
    for i, (pos, dur) in enumerate(zip(clip_positions, clip_durations)):
        print(f"   片段{i+1}: {pos:.1f} ~ {pos+dur:.1f}s ({dur:.1f}s)")
        if i < len(clip_durations) - 1:
            gap_start = pos + dur
            print(f"   过渡: {gap_start:.1f} ~ {gap_start + args.gap_dur:.1f}s")
    print(f"   尾声: {cursor - args.gap_dur:.1f} ~ {total_dur:.1f}s")
    print(f"   总时长: {total_dur:.1f}s")

    if args.theme_start + total_dur > theme_dur:
        print(f"   ⚠️ 主题曲 ({theme_dur:.0f}s) 可能不够长，将自动循环")

    work_dir = tempfile.mkdtemp(prefix='podcastcut_mix_')
    print(f"\n🔧 工作目录: {work_dir}")

    try:
        # ===== Step 1: 创建连续背景音乐轨 =====
        print("\n🎵 Step 1: 创建连续背景音乐轨...")

        vol_expr = build_volume_expression(timeline, args.music_vol, args.fade_transition)

        music_bed = os.path.join(work_dir, 'music_bed.wav')
        theme_end = args.theme_start + total_dur
        fade_out_start = total_dur - 3

        af_filter = (
            f"atrim=start={args.theme_start:.3f}:end={theme_end:.3f},"
            f"asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=2,"
            f"afade=t=out:st={fade_out_start:.3f}:d=3,"
            f"volume=eval=frame:volume='{vol_expr}'"
        )

        cmd = [
            'ffmpeg', '-v', 'warning',
            '-i', args.theme,
            '-af', af_filter,
            '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2',
            '-y', music_bed
        ]
        subprocess.run(cmd, check=True)

        # 检查音量
        vol = check_volume(music_bed)
        print(f"   音乐轨: {total_dur:.1f}s, max_volume={vol:.1f}dB")
        if vol < -40:
            print(f"   ⚠️ 音乐轨音量太低 ({vol:.1f}dB)，可能是静音！检查 --theme-start 参数")

        # ===== Step 2: 创建人声轨 =====
        print("\n🎤 Step 2: 创建人声轨（amerge+pan 逐步叠加）...")

        # 2a. 创建静音基底
        silence = os.path.join(work_dir, 'silence.wav')
        cmd = [
            'ffmpeg', '-v', 'warning',
            '-f', 'lavfi', '-i', f'anullsrc=r=44100:cl=stereo',
            '-t', str(total_dur),
            '-c:a', 'pcm_s16le',
            '-y', silence
        ]
        subprocess.run(cmd, check=True)

        # 2b. 逐个叠加人声
        current_base = silence
        for i, (clip, pos) in enumerate(zip(args.clips, clip_positions)):
            delay_ms = int(pos * 1000)
            step_out = os.path.join(work_dir, f'voice_step{i+1}.wav')

            cmd = [
                'ffmpeg', '-v', 'warning',
                '-i', current_base,
                '-i', clip,
                '-filter_complex',
                f"[1:a]volume={args.voice_gain},adelay={delay_ms}|{delay_ms},apad=whole_dur={total_dur:.3f}[v];"
                f"[0:a][v]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]",
                '-map', '[out]',
                '-c:a', 'pcm_s16le',
                '-y', step_out
            ]
            subprocess.run(cmd, check=True)
            print(f"   叠加片段{i+1}: delay={delay_ms}ms, gain={args.voice_gain}x")
            current_base = step_out

        voice_track = current_base

        # ===== Step 3: 混合音乐 + 人声 =====
        print("\n🔗 Step 3: 混合音乐轨 + 人声轨...")

        cmd = [
            'ffmpeg', '-v', 'warning',
            '-i', music_bed,
            '-i', voice_track,
            '-filter_complex',
            '[0:a][1:a]amerge=inputs=2,pan=stereo|c0=c0+c2|c1=c1+c3[out]',
            '-map', '[out]',
            '-c:a', 'pcm_s16le',
            '-y', args.output
        ]
        subprocess.run(cmd, check=True)

        # 最终检查
        final_dur = get_duration(args.output)
        final_vol = check_volume(args.output)
        print(f"\n✅ 完成: {args.output}")
        print(f"   时长: {final_dur:.1f}s, max_volume={final_vol:.1f}dB")

        # 输出时间线 JSON（供后续时间戳偏移计算）
        timeline_info = {
            'total_duration': round(total_dur, 3),
            'intro_music_end': args.intro_dur,
            'clips': [
                {
                    'file': os.path.basename(clip),
                    'start': round(pos, 3),
                    'end': round(pos + dur, 3),
                    'duration': round(dur, 3)
                }
                for clip, pos, dur in zip(args.clips, clip_positions, clip_durations)
            ],
            'outro_start': round(total_dur - args.outro_dur, 3)
        }
        timeline_path = args.output.replace('.wav', '_timeline.json').replace('.mp3', '_timeline.json')
        with open(timeline_path, 'w') as f:
            json.dump(timeline_info, f, indent=2, ensure_ascii=False)
        print(f"   时间线: {timeline_path}")

    finally:
        # 清理临时文件
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)
        print(f"\n🧹 已清理临时文件")


if __name__ == '__main__':
    main()

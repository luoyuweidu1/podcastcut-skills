#!/usr/bin/env python3
"""
步骤9: 一键剪辑生成精剪版

用法: python3 cut_audio.py [output_name.mp3] [audio_file] [delete_segments.json]
默认:
  - output_name: 播客_精剪版_v1.mp3
  - audio_file: ../1_转录/audio.mp3
  - delete_segments: delete_segments.json

v2: 先解码为 WAV 再切割，确保采样级精确（MP3 -c copy 只有帧级精度 ~26ms）。
"""

import json
import subprocess
import sys
import os

def main():
    # 参数解析
    output_name = sys.argv[1] if len(sys.argv) > 1 else '播客_精剪版_v1.mp3'
    audio_file = sys.argv[2] if len(sys.argv) > 2 else '../1_转录/audio.mp3'
    delete_file = sys.argv[3] if len(sys.argv) > 3 else 'delete_segments.json'

    # 检查文件
    if not os.path.exists(audio_file):
        print(f"❌ 找不到音频文件: {audio_file}")
        sys.exit(1)

    if not os.path.exists(delete_file):
        print(f"❌ 找不到删除片段文件: {delete_file}")
        sys.exit(1)

    # 读取删除片段
    with open(delete_file) as f:
        delete_segs = json.load(f)

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

    # 从 WAV 提取保留片段（-c copy 对 WAV 是采样级精确的）
    print("🎬 提取保留片段...")
    segment_files = []

    for i, (start, end) in enumerate(keep_segs):
        output = f'segment_{i:04d}.wav'
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

    print(f"✅ 已提取所有 {len(keep_segs)} 个片段")
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

    # 编码为 MP3
    print("🔧 编码为 MP3...")
    cmd = [
        'ffmpeg', '-v', 'quiet', '-stats',
        '-i', temp_concat,
        '-c:a', 'libmp3lame', '-b:a', '64k',
        '-y', output_name
    ]
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

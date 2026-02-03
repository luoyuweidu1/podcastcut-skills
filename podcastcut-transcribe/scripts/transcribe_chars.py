#!/usr/bin/env python3
"""
字符级时间戳转录 + 说话人分离

功能：
1. 30s 分段转录（字符级时间戳）- 避免 FunASR 长音频时间戳漂移
2. 说话人分离（CAM++ 模型）
3. 合并字符级时间戳和说话人信息
4. 聚合为句子级（兼容其他工具）

用法：
    python transcribe_chars.py <音频文件> <输出目录>

示例：
    python transcribe_chars.py podcast.mp3 /path/to/output

输出文件：
    - podcast_transcript_chars.json  # 字符级时间戳（含说话人）
    - podcast_transcript.json        # 句子级时间戳（兼容）
    - podcast_transcript_spk.json    # 说话人分离结果
"""
import subprocess
import os
import json
import sys
from pathlib import Path


def get_duration(audio_path):
    """获取音频时长"""
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', audio_path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())


def transcribe_with_chars(audio_path, output_dir, segment_len=30):
    """
    30s 分段转录，输出字符级时间戳

    为什么用 30s 分段：FunASR 长音频有时间戳漂移问题
    """
    from funasr import AutoModel

    duration = get_duration(audio_path)
    print(f"音频时长: {duration:.1f}s ({duration/60:.1f}分钟)")

    # 加载模型
    print("加载 FunASR 模型...")
    model = AutoModel(model="paraformer-zh", disable_update=True)

    all_chars = []
    num_segments = int(duration // segment_len) + 1

    print(f"开始分段转录，共 {num_segments} 个片段...")

    for i in range(num_segments):
        start = i * segment_len
        dur = min(segment_len, duration - start)
        if dur <= 0:
            break

        wav = f'/tmp/seg_{i}.wav'

        # 提取音频段
        subprocess.run(
            ['ffmpeg', '-y', '-i', audio_path, '-ss', str(start), '-t', str(dur),
             '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wav],
            capture_output=True
        )

        # FunASR 转录（字符级时间戳）
        try:
            result = model.generate(
                input=wav,
                return_raw_text=True,
                timestamp_granularity="character"
            )

            for item in result:
                if 'timestamp' in item and 'text' in item:
                    text = item['text'].replace(' ', '')
                    timestamps = item['timestamp']
                    # 确保 text 和 timestamps 长度匹配
                    for j, char in enumerate(text):
                        if j < len(timestamps):
                            ts = timestamps[j]
                            all_chars.append({
                                'char': char,
                                'start': round(start + ts[0] / 1000, 3),
                                'end': round(start + ts[1] / 1000, 3)
                            })
        except Exception as e:
            print(f"  片段 {i} 转录失败: {e}")

        os.remove(wav)

        # 进度
        if (i + 1) % 10 == 0 or i == num_segments - 1:
            print(f"  进度: {i+1}/{num_segments} ({(i+1)*100/num_segments:.1f}%)")

    result = {
        'file': str(audio_path),
        'duration': duration,
        'chars': all_chars
    }

    # 保存
    output_path = Path(output_dir) / 'podcast_transcript_chars.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n字符级转录完成: {len(all_chars)} 个字符")
    print(f"保存到: {output_path}")

    return result


def transcribe_with_speaker(audio_path, output_dir):
    """
    句子级转录 + 说话人分离

    注意：说话人分离需要完整音频，长音频可能 OOM
    """
    from funasr import AutoModel

    print("\n开始说话人分离转录...")

    # 先提取完整音频
    wav_path = '/tmp/full_audio.wav'
    subprocess.run(
        ['ffmpeg', '-y', '-i', audio_path,
         '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wav_path],
        capture_output=True
    )

    # 加载模型（带说话人分离）
    model = AutoModel(
        model="paraformer-zh",
        spk_model="cam++",
        disable_update=True
    )

    result = model.generate(
        input=wav_path,
        return_raw_text=True,
        sentence_timestamp=True
    )

    os.remove(wav_path)

    sentences = []
    for item in result:
        if 'sentence_info' in item:
            for sent in item['sentence_info']:
                sentences.append({
                    'text': sent['text'],
                    'start': sent['start'] / 1000,
                    'end': sent['end'] / 1000,
                    'spk': sent.get('spk', 0)
                })

    # 保存
    output_path = Path(output_dir) / 'podcast_transcript_spk.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({'sentences': sentences}, f, ensure_ascii=False, indent=2)

    print(f"说话人分离完成: {len(sentences)} 个句子")
    print(f"保存到: {output_path}")

    return sentences


def merge_chars_with_speaker(chars_data, spk_sentences, output_dir):
    """
    合并字符级时间戳和说话人信息

    原理：根据字符的时间中点，找到对应的说话人句子
    """
    print("\n合并字符级时间戳和说话人信息...")

    chars = chars_data['chars']

    # 为每个字符分配说话人
    for c in chars:
        char_mid = (c['start'] + c['end']) / 2
        c['spk'] = 0  # 默认
        for sent in spk_sentences:
            if sent['start'] <= char_mid <= sent['end']:
                c['spk'] = sent.get('spk', 0)
                break

    # 保存合并结果
    result = {
        'file': chars_data['file'],
        'duration': chars_data['duration'],
        'chars': chars
    }

    output_path = Path(output_dir) / 'podcast_transcript_chars.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"合并完成，保存到: {output_path}")
    return result


def chars_to_sentences(chars, punctuation='。！？'):
    """
    将字符级时间戳聚合为句子

    按标点符号分割，保留说话人信息
    """
    sentences = []
    current_text = ''
    current_start = None
    current_spk = None

    for c in chars:
        if current_start is None:
            current_start = c['start']
            current_spk = c.get('spk', 0)
        current_text += c['char']

        if c['char'] in punctuation:
            sentences.append({
                'text': current_text,
                'start': current_start,
                'end': c['end'],
                'spk': current_spk
            })
            current_text = ''
            current_start = None
            current_spk = None

    # 最后一句（可能没有句号）
    if current_text and chars:
        sentences.append({
            'text': current_text,
            'start': current_start,
            'end': chars[-1]['end'],
            'spk': current_spk
        })

    return sentences


def main():
    if len(sys.argv) < 3:
        print("用法: python transcribe_chars.py <音频文件> <输出目录>")
        print("\n示例:")
        print("  python transcribe_chars.py podcast.mp3 /path/to/output")
        sys.exit(1)

    audio_path = sys.argv[1]
    output_dir = sys.argv[2]

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # 1. 字符级转录
    chars_data = transcribe_with_chars(audio_path, output_dir)

    # 2. 说话人分离
    spk_sentences = transcribe_with_speaker(audio_path, output_dir)

    # 3. 合并
    merged = merge_chars_with_speaker(chars_data, spk_sentences, output_dir)

    # 4. 生成句子级（兼容）
    sentences = chars_to_sentences(merged['chars'])
    sentence_output = {
        'file': merged['file'],
        'duration': merged['duration'],
        'sentences': sentences
    }

    output_path = Path(output_dir) / 'podcast_transcript.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(sentence_output, f, ensure_ascii=False, indent=2)

    print(f"\n句子级转录保存到: {output_path}")
    print(f"共 {len(merged['chars'])} 个字符，{len(sentences)} 个句子")
    print("\n转录完成！")


if __name__ == '__main__':
    main()

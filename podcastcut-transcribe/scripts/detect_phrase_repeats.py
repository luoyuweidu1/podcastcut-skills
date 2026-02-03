#!/usr/bin/env python3
"""
检测短语级重复 (N-gram 滑动窗口)

用法: python detect_phrase_repeats.py <工作目录>

输入:
  - transcript_chars.json (字符级时间戳)

输出:
  - phrase_repeats.json

原理:
  - N-gram 滑动窗口 (4-12字)
  - 在后续文本中查找重复
  - 保留第二个，删除第一个
"""

import json
import re
import sys
from pathlib import Path


def load_transcript_chars(work_dir):
    """加载字符级时间戳"""
    path = work_dir / "transcript_chars.json"
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        return data['chars'] if isinstance(data, dict) and 'chars' in data else data


def get_full_text(chars):
    """从字符列表构建完整文本"""
    return ''.join(c['char'] for c in chars)


def detect_phrase_repetitions(text, chars, min_len=4, max_len=12):
    """
    检测短语级重复 (N-gram)

    Args:
        text: 完整文本
        chars: 字符级时间戳列表
        min_len: 最小短语长度
        max_len: 最大短语长度

    Returns:
        list: 检测到的重复列表
    """
    repetitions = []
    found_ranges = []

    for phrase_len in range(max_len, min_len - 1, -1):
        i = 0
        while i < len(text) - phrase_len:
            phrase = text[i:i + phrase_len]

            # 跳过纯标点/空格/语气词
            clean_phrase = re.sub(r'[，。？！、：；""''（）《》【】\s\.,!?;:\'"()嗯啊哎呃额诶唉哦噢呀欸]', '', phrase)
            if len(clean_phrase) < min_len:
                i += 1
                continue

            # 跳过纯英文（不是口误）
            if phrase.isascii() and phrase.isalpha():
                i += 1
                continue

            # 检查是否在已找到的范围内
            in_found = False
            for (start, end) in found_ranges:
                if start <= i < end:
                    in_found = True
                    break
            if in_found:
                i += 1
                continue

            # 在后续文本中查找重复
            search_start = i + phrase_len
            search_end = min(i + phrase_len * 2 + 10, len(text))
            rest = text[search_start:search_end]

            if phrase in rest:
                repeat_pos = rest.find(phrase)

                first_start_idx = i
                first_end_idx = search_start + repeat_pos

                if first_start_idx < len(chars) and first_end_idx <= len(chars):
                    start_time = chars[first_start_idx]['start']
                    end_time = chars[first_end_idx - 1]['end'] if first_end_idx > 0 else chars[first_start_idx]['end']

                    # 过滤时间跨度太大的
                    if end_time - start_time > 10:
                        i += 1
                        continue

                    delete_text = text[first_start_idx:first_end_idx]

                    repetitions.append({
                        'type': 'phrase_repeat',
                        'phrase': phrase,
                        'delete_text': delete_text,
                        'keep_text': phrase,
                        'start': round(start_time, 3),
                        'end': round(end_time, 3),
                        'start_idx': first_start_idx,
                        'end_idx': first_end_idx,
                        'action': 'delete_first'
                    })

                    found_ranges.append((first_start_idx, search_start + repeat_pos + phrase_len))

                i = search_start + repeat_pos + phrase_len
            else:
                i += 1

    return repetitions


def main():
    if len(sys.argv) < 2:
        print("用法: python detect_phrase_repeats.py <工作目录>")
        sys.exit(1)

    work_dir = Path(sys.argv[1])

    print("加载字符级时间戳...")
    chars = load_transcript_chars(work_dir)
    full_text = get_full_text(chars)
    print(f"总字符数: {len(chars)}")

    print("\n检测短语级重复...")
    phrase_repeats = detect_phrase_repetitions(full_text, chars)
    print(f"找到 {len(phrase_repeats)} 处短语重复")

    # 保存结果
    output_path = work_dir / "phrase_repeats.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(phrase_repeats, f, ensure_ascii=False, indent=2)
    print(f"已保存: {output_path}")

    # 打印示例
    for rep in phrase_repeats[:5]:
        print(f"  [{rep['start']:.2f}-{rep['end']:.2f}] \"{rep['delete_text'][:30]}\" → 保留\"{rep['keep_text']}\"")


if __name__ == "__main__":
    main()

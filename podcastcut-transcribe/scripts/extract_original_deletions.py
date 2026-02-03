#!/usr/bin/env python3
"""
从原审查稿提取未处理的删除标记

用法: python extract_original_deletions.py <工作目录> <原审查稿路径>

输入:
  - transcript_chars.json (字符级时间戳)
  - 原审查稿 (*.md，包含 ~~删除线~~ 标记)

输出:
  - original_deletions.json

原理:
  - 解析 ~~删除线~~ 标记
  - 用字符级时间戳定位文本位置
  - 生成精确的时间范围
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


def extract_original_deletions(review_path, chars, full_text):
    """从原审查稿提取删除标记"""
    deletions = []

    with open(review_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 解析 ~~删除标记~~
    pattern = r'~~([^~]+)~~'
    for match in re.finditer(pattern, content):
        deleted_text = match.group(1)

        # 清理文本用于匹配
        clean_deleted = re.sub(r'[，。？！、：；""''（）《》【】\s\.,!?;:\'"()]', '', deleted_text)
        clean_full = re.sub(r'[，。？！、：；""''（）《》【】\s\.,!?;:\'"()]', '', full_text)

        if len(clean_deleted) < 2:
            continue

        pos = clean_full.find(clean_deleted)
        if pos == -1:
            continue

        # 计算字符索引
        clean_idx = 0
        start_idx = None
        end_idx = None

        for full_idx, char in enumerate(full_text):
            clean_char = re.sub(r'[，。？！、：；""''（）《》【】\s\.,!?;:\'"()]', '', char)
            if clean_char:
                if clean_idx == pos and start_idx is None:
                    start_idx = full_idx
                if clean_idx == pos + len(clean_deleted):
                    end_idx = full_idx
                    break
                clean_idx += 1

        if start_idx is not None and end_idx is None:
            end_idx = len(chars)

        if start_idx is not None and end_idx is not None and start_idx < len(chars) and end_idx <= len(chars):
            start_time = chars[start_idx]['start']
            end_time = chars[end_idx - 1]['end'] if end_idx > 0 else chars[start_idx]['end']

            deletions.append({
                'type': 'original_review',
                'text': deleted_text,
                'start': round(start_time, 3),
                'end': round(end_time, 3),
                'start_idx': start_idx,
                'end_idx': end_idx
            })

    return deletions


def main():
    if len(sys.argv) < 3:
        print("用法: python extract_original_deletions.py <工作目录> <原审查稿路径>")
        sys.exit(1)

    work_dir = Path(sys.argv[1])
    review_path = Path(sys.argv[2])

    print("加载字符级时间戳...")
    chars = load_transcript_chars(work_dir)
    full_text = get_full_text(chars)

    print(f"从 {review_path} 提取删除标记...")
    deletions = extract_original_deletions(review_path, chars, full_text)
    print(f"找到 {len(deletions)} 处删除标记")

    # 保存结果
    output_path = work_dir / "original_deletions.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(deletions, f, ensure_ascii=False, indent=2)
    print(f"已保存: {output_path}")

    for d in deletions[:5]:
        print(f"  [{d['start']:.2f}-{d['end']:.2f}] \"{d['text'][:30]}\"")


if __name__ == "__main__":
    main()

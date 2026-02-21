#!/usr/bin/env python3
"""
剪辑样本分析器 — 从剪辑前后音频对比中提取编辑偏好

通过对比原始录音和已发布的剪辑版，自动识别用户的编辑风格：
- 填充词删除率
- 静音段处理阈值
- 内容块删减激进度
- 重复/口误处理方式

用法:
    python3 analyze_editing_samples.py \\
        --before /path/to/原始录音.mp3 \\
        --after /path/to/发布版.mp3 \\
        --before-transcript /path/to/before_transcript.json \\
        --after-transcript /path/to/after_transcript.json \\
        --output /path/to/learned_patterns.json

如果没有提供 transcript，会提示使用阿里云 FunASR 先转录。

依赖: pip install librosa numpy
"""

import argparse
import json
import sys
import re
from pathlib import Path
from difflib import SequenceMatcher
from collections import Counter, defaultdict

# --- 填充词和语气词定义 ---

FILLER_WORDS = {
    '嗯', '啊', '呃', '额', '哦', '噢',
    '就是', '然后', '那个', '这个', '所以',
    '对对对', '对对', '是是是',
    '哈哈', '哈哈哈', '嗯嗯', '嗯嗯嗯',
    '啊啊', '呃呃'
}

STUTTER_PATTERNS = [
    r'(.{1,3})\1{1,}',  # 连续重复，如"那那那"
]

# --- 文本预处理 ---

def normalize_text(text):
    """标准化文本用于对齐"""
    text = text.strip()
    text = re.sub(r'\s+', '', text)  # 移除所有空格
    text = re.sub(r'[，。！？、；：""''（）【】]', '', text)  # 移除标点
    return text

def extract_sentences_from_transcript(transcript_data):
    """从转录 JSON 提取句子列表"""
    sentences = []

    if isinstance(transcript_data, list):
        # subtitles_words.json 格式
        current_sentence = []
        current_speaker = None

        for word in transcript_data:
            if word.get('isSpeakerLabel'):
                if current_sentence:
                    text = ''.join(w['text'] for w in current_sentence)
                    sentences.append({
                        'text': text,
                        'speaker': current_speaker,
                        'start': current_sentence[0].get('start', 0),
                        'end': current_sentence[-1].get('end', 0),
                        'words': current_sentence
                    })
                    current_sentence = []
                current_speaker = word.get('speaker', '')
            elif word.get('isGap'):
                # 静音段，检查时长
                gap_duration = word.get('end', 0) - word.get('start', 0)
                if gap_duration > 0.5 and current_sentence:
                    text = ''.join(w['text'] for w in current_sentence)
                    sentences.append({
                        'text': text,
                        'speaker': current_speaker,
                        'start': current_sentence[0].get('start', 0),
                        'end': current_sentence[-1].get('end', 0),
                        'words': current_sentence,
                        'gap_after': gap_duration
                    })
                    current_sentence = []
            else:
                current_sentence.append(word)

        if current_sentence:
            text = ''.join(w['text'] for w in current_sentence)
            sentences.append({
                'text': text,
                'speaker': current_speaker,
                'start': current_sentence[0].get('start', 0),
                'end': current_sentence[-1].get('end', 0),
                'words': current_sentence
            })

    elif isinstance(transcript_data, dict):
        # 阿里云原始格式
        for transcript in transcript_data.get('transcripts', []):
            for sent in transcript.get('sentences', []):
                sentences.append({
                    'text': sent.get('text', ''),
                    'speaker': str(sent.get('speaker_id', '')),
                    'start': sent.get('begin_time', 0) / 1000,
                    'end': sent.get('end_time', 0) / 1000,
                    'words': sent.get('words', [])
                })

    return sentences


# --- 文本对齐和差异分析 ---

def align_transcripts(before_sentences, after_sentences):
    """对齐剪辑前后的转录文本，找出被删除的部分"""
    before_text = [normalize_text(s['text']) for s in before_sentences]
    after_text = [normalize_text(s['text']) for s in after_sentences]

    # 使用 SequenceMatcher 找到最长公共子序列
    matcher = SequenceMatcher(None, before_text, after_text)

    kept = []      # 保留的句子索引（before 侧）
    deleted = []   # 被删除的句子索引（before 侧）

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == 'equal':
            for i in range(i1, i2):
                kept.append(i)
        elif op == 'delete':
            for i in range(i1, i2):
                deleted.append(i)
        elif op == 'replace':
            # replace 可能是部分匹配，尝试细粒度对齐
            for i in range(i1, i2):
                # 检查 before[i] 是否在 after[j1:j2] 中有近似匹配
                best_ratio = 0
                for j in range(j1, j2):
                    ratio = SequenceMatcher(None, before_text[i], after_text[j]).ratio()
                    best_ratio = max(best_ratio, ratio)
                if best_ratio > 0.7:
                    kept.append(i)
                else:
                    deleted.append(i)

    return kept, deleted


def classify_deletion(sentence, before_sentences, idx, deleted_indices):
    """对删除的句子进行分类"""
    text = sentence['text']
    normalized = normalize_text(text)

    # 检查是否为纯填充词
    if normalized in FILLER_WORDS or len(normalized) <= 2 and normalized in {'嗯', '啊', '呃', '哦'}:
        return 'filler_word', text

    # 检查是否为卡顿/重复
    for pattern in STUTTER_PATTERNS:
        if re.search(pattern, normalized):
            return 'stutter', text

    # 检查是否为短句（可能是残句）
    if len(normalized) < 5:
        return 'residual', text

    # 检查是否为连续删除（内容块）
    neighbors_deleted = sum(1 for d in deleted_indices
                            if abs(d - idx) <= 3 and d != idx)
    if neighbors_deleted >= 2:
        return 'content_block', text

    # 检查静音段后的删除
    if sentence.get('gap_after', 0) > 2.0:
        return 'silence_related', text

    # 默认分类
    return 'other', text


# --- 统计分析 ---

def analyze_patterns(before_sentences, kept, deleted):
    """从删除模式中提取统计规律"""
    total = len(before_sentences)
    deleted_set = set(deleted)

    # 统计各类删除
    deletion_types = defaultdict(list)
    filler_stats = Counter()
    filler_total = Counter()

    for idx in range(total):
        sentence = before_sentences[idx]
        text = normalize_text(sentence['text'])

        # 统计填充词总数
        for fw in FILLER_WORDS:
            count = text.count(fw)
            if count > 0:
                filler_total[fw] += count

        if idx in deleted_set:
            dtype, detail = classify_deletion(sentence, before_sentences, idx, deleted)
            deletion_types[dtype].append({
                'idx': idx,
                'text': sentence['text'][:50],
                'duration': sentence.get('end', 0) - sentence.get('start', 0)
            })

            # 统计被删除的填充词
            for fw in FILLER_WORDS:
                count = text.count(fw)
                if count > 0:
                    filler_stats[fw] += count

    # 计算填充词删除率
    filler_deletion_rates = {}
    for fw in filler_total:
        total_count = filler_total[fw]
        deleted_count = filler_stats.get(fw, 0)
        if total_count > 0:
            rate = deleted_count / total_count
            filler_deletion_rates[fw] = {
                'total': total_count,
                'deleted': deleted_count,
                'rate': round(rate, 2)
            }

    # 估计静音阈值
    silence_durations = []
    for idx in deleted_set:
        gap = before_sentences[idx].get('gap_after', 0)
        if gap > 0.5:
            silence_durations.append(gap)

    silence_threshold = None
    if silence_durations:
        silence_threshold = round(min(silence_durations), 1)

    # 计算时长统计
    before_duration = max(s.get('end', 0) for s in before_sentences) if before_sentences else 0
    deleted_duration = sum(
        before_sentences[i].get('end', 0) - before_sentences[i].get('start', 0)
        for i in deleted_set
    )

    return {
        'version': '1.0',
        'summary': {
            'total_sentences': total,
            'kept_sentences': len(kept),
            'deleted_sentences': len(deleted),
            'deletion_rate': round(len(deleted) / total, 2) if total > 0 else 0,
            'before_duration_seconds': round(before_duration, 1),
            'deleted_duration_seconds': round(deleted_duration, 1),
            'reduction_percent': round(deleted_duration / before_duration * 100, 1) if before_duration > 0 else 0
        },
        'deletion_types': {
            dtype: {
                'count': len(items),
                'total_duration': round(sum(i['duration'] for i in items), 1),
                'examples': [i['text'] for i in items[:3]]
            }
            for dtype, items in deletion_types.items()
        },
        'filler_word_analysis': filler_deletion_rates,
        'silence_analysis': {
            'estimated_threshold': silence_threshold,
            'deleted_silence_count': len(silence_durations),
            'silence_durations': sorted(silence_durations)[:10]  # 前 10 个
        },
        'aggressiveness': classify_aggressiveness(len(deleted) / total if total > 0 else 0),
        'recommendations': generate_recommendations(
            filler_deletion_rates, silence_threshold,
            len(deleted) / total if total > 0 else 0,
            deletion_types
        )
    }


def classify_aggressiveness(deletion_rate):
    """根据删除率判断激进度"""
    if deletion_rate < 0.15:
        return 'conservative'
    elif deletion_rate < 0.30:
        return 'moderate'
    else:
        return 'aggressive'


def generate_recommendations(filler_rates, silence_threshold, deletion_rate, deletion_types):
    """生成 editing_rules 建议"""
    recs = []

    # 填充词建议
    high_delete = [fw for fw, data in filler_rates.items() if data['rate'] > 0.6]
    low_delete = [fw for fw, data in filler_rates.items() if data['rate'] < 0.3]

    if high_delete:
        recs.append({
            'rule': 'filler_words',
            'action': 'set_high_deletion',
            'words': high_delete,
            'confidence': 0.85,
            'reason': f'这些填充词在样本中被删除超过 60%: {", ".join(high_delete)}'
        })

    if low_delete:
        recs.append({
            'rule': 'filler_words',
            'action': 'preserve',
            'words': low_delete,
            'confidence': 0.80,
            'reason': f'这些填充词在样本中大多被保留: {", ".join(low_delete)}'
        })

    # 静音阈值建议
    if silence_threshold:
        recs.append({
            'rule': 'silence',
            'action': 'set_threshold',
            'value': silence_threshold,
            'confidence': 0.75,
            'reason': f'样本中删除的最短静音段为 {silence_threshold}s'
        })

    # 激进度建议
    recs.append({
        'rule': 'aggressiveness',
        'action': 'set',
        'value': classify_aggressiveness(deletion_rate),
        'confidence': 0.90,
        'reason': f'样本总体删除率 {deletion_rate:.0%}'
    })

    return recs


# --- 主逻辑 ---

def main():
    parser = argparse.ArgumentParser(
        description='从剪辑前后音频对比中提取编辑偏好',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 使用已有转录
  python3 analyze_editing_samples.py \\
      --before-transcript before_words.json \\
      --after-transcript after_words.json \\
      --output learned_patterns.json

  # 完整流程（需先用阿里云转录两个音频）
  python3 analyze_editing_samples.py \\
      --before 原始录音.mp3 \\
      --after 发布版.mp3 \\
      --output learned_patterns.json
        """
    )
    parser.add_argument('--before', help='原始音频文件路径')
    parser.add_argument('--after', help='剪辑后音频文件路径')
    parser.add_argument('--before-transcript', help='原始音频的转录 JSON')
    parser.add_argument('--after-transcript', help='剪辑后音频的转录 JSON')
    parser.add_argument('--output', required=True, help='输出 learned_patterns.json 路径')

    args = parser.parse_args()

    # 检查输入
    if not args.before_transcript or not args.after_transcript:
        if args.before and args.after:
            print("⚠️  未提供转录文件。请先使用阿里云 FunASR 转录两个音频：", file=sys.stderr)
            print(f"   1. 转录原始音频: {args.before}", file=sys.stderr)
            print(f"   2. 转录剪辑版: {args.after}", file=sys.stderr)
            print("   3. 将两个 subtitles_words.json 分别传入 --before-transcript 和 --after-transcript", file=sys.stderr)
            sys.exit(1)
        else:
            parser.print_help()
            sys.exit(1)

    # 加载转录
    print("📖 加载转录文件...", file=sys.stderr)
    with open(args.before_transcript, 'r', encoding='utf-8') as f:
        before_data = json.load(f)
    with open(args.after_transcript, 'r', encoding='utf-8') as f:
        after_data = json.load(f)

    # 提取句子
    before_sentences = extract_sentences_from_transcript(before_data)
    after_sentences = extract_sentences_from_transcript(after_data)

    print(f"   原始: {len(before_sentences)} 句", file=sys.stderr)
    print(f"   剪辑版: {len(after_sentences)} 句", file=sys.stderr)

    # 对齐和分析
    print("🔍 对齐转录文本...", file=sys.stderr)
    kept, deleted = align_transcripts(before_sentences, after_sentences)
    print(f"   保留: {len(kept)} 句, 删除: {len(deleted)} 句", file=sys.stderr)

    # 分析模式
    print("📊 分析编辑模式...", file=sys.stderr)
    patterns = analyze_patterns(before_sentences, kept, deleted)

    # 保存结果
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(patterns, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 分析完成，结果已保存: {output_path}", file=sys.stderr)
    print(f"   总体删减率: {patterns['summary']['reduction_percent']}%", file=sys.stderr)
    print(f"   激进度: {patterns['aggressiveness']}", file=sys.stderr)
    print(f"   建议数量: {len(patterns['recommendations'])}", file=sys.stderr)

    # 输出到 stdout（供管道使用）
    print(json.dumps(patterns, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

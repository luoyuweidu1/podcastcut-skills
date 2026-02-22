#!/usr/bin/env python3
"""
Layer 3: 综合质检报告生成

合并 Layer 1（信号分析）和 Layer 2（AI 听感评估）的结果，
生成结构化 JSON 报告 + 人类可读 Markdown 摘要。

用法：
    python3 report_generator.py --signal qa_signal_report.json --output qa_report.json --summary qa_summary.md
    python3 report_generator.py --signal qa_signal_report.json --ai qa_ai_report.json --output qa_report.json --summary qa_summary.md
"""

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)


def format_time(seconds):
    """格式化时间为 MM:SS 或 H:MM:SS"""
    m, s = divmod(int(seconds), 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def recalculate_signal_score(signal_report, podcast_mode=True):
    """
    重新计算信号评分（播客模式使用更宽松的阈值）

    播客中自然语气变化产生的能量比会触发低阈值——
    AI 复查确认 energy_jump 在播客中几乎全是假阳性（自然换人/语气变化），
    即使 105x 的能量比也是正常的说话人切换。

    播客模式下：
    - energy_jump 完全忽略（AI 已证实全部假阳性）
    - 只保留 spectral_jump（频谱跳变，可能是背景噪声变化）
    - 只保留 unnatural_silence（不自然静音，可能是剪切痕迹）
    - ZCR 和呼吸音截断误报太多，忽略
    """
    issues = signal_report.get('issues', [])

    if podcast_mode:
        significant = []
        for issue in issues:
            if issue['type'] == 'spectral_jump':
                significant.append(issue)
            elif issue['type'] == 'unnatural_silence':
                significant.append(issue)
            # energy_jump: 播客中全是假阳性（自然语气/说话人切换），忽略
            # zcr_discontinuity: 播客中误报太多，忽略
            # breath_truncation: 播客中误报太多，忽略
    else:
        significant = issues

    high = sum(1 for i in significant if i.get('severity') == 'high')
    medium = sum(1 for i in significant if i.get('severity') == 'medium')
    low = sum(1 for i in significant if i.get('severity') == 'low')

    deduction = high * 0.8 + medium * 0.3 + low * 0.1
    score = max(1.0, round(10.0 - deduction, 1))

    return score, significant


def merge_scores(signal_score, ai_score=None):
    """合并两层评分"""
    if ai_score is not None:
        # AI 听感权重更高（人耳判断更可靠）
        return round(0.4 * signal_score + 0.6 * ai_score, 1)
    return signal_score


def collect_review_items(signal_issues, ai_evals=None):
    """收集需要人工复听的片段"""
    items = []

    # 从信号分析中收集（已过滤后的显著问题）
    for issue in signal_issues:
        items.append({
            "time": issue['timestamp'],
            "time_str": format_time(issue['timestamp']),
            "source": "signal",
            "type": issue['type'],
            "severity": issue['severity'],
            "detail": issue['detail'],
            "suggestion": issue.get('suggestion', ''),
            "listen_range": issue.get('listen_range', []),
        })

    # 从 AI 评估中收集
    if ai_evals:
        for ev in ai_evals:
            if ev['strategy'] == 'global_sampling':
                for issue in ev.get('issues', []):
                    items.append({
                        "time": issue.get('time', 0),
                        "time_str": format_time(issue.get('time', 0)),
                        "source": "ai",
                        "type": "ai_detected",
                        "severity": "medium",
                        "detail": issue.get('description', ''),
                        "suggestion": "人工复听确认",
                        "listen_range": ev.get('clip_range', []),
                    })
            elif ev['strategy'] == 'suspicious_review' and ev.get('is_real_issue'):
                orig = ev.get('original_issue', {})
                items.append({
                    "time": orig.get('timestamp', 0),
                    "time_str": format_time(orig.get('timestamp', 0)),
                    "source": "ai_confirmed",
                    "type": orig.get('type', 'unknown'),
                    "severity": "high",
                    "detail": f"AI 确认: {ev.get('explanation', '')}",
                    "suggestion": ev.get('explanation', ''),
                    "listen_range": ev.get('clip_range', []),
                })

    # 按时间排序，去重（5s 内同源的合并）
    items.sort(key=lambda x: x['time'])
    deduped = []
    for item in items:
        if not deduped or abs(item['time'] - deduped[-1]['time']) > 5 or item['source'] != deduped[-1]['source']:
            deduped.append(item)

    return deduped


def generate_markdown(report):
    """生成人类可读的 Markdown 摘要"""
    lines = []
    lines.append("# 播客剪辑质检报告\n")
    lines.append(f"**音频**: {report['audio_file']}")
    lines.append(f"**时长**: {format_time(report['duration_seconds'])}")

    cut_points = report.get('detected_cut_points', 'N/A')
    lines.append(f"**检测剪切点**: {cut_points} 个")

    score = report['overall_score']
    score_emoji = "🟢" if score >= 8 else "🟡" if score >= 6 else "🔴"
    lines.append(f"**总体评分**: {score_emoji} {score} / 10\n")

    # 评分来源
    if report.get('ai_score') is not None:
        lines.append(f"> 信号评分: {report['signal_score']}/10 | AI 评分: {report['ai_score']}/10 | 综合: {score}/10\n")
    else:
        lines.append(f"> 信号评分: {report['signal_score']}/10（未使用 AI 评估）\n")

    # 需要复听的片段
    review_items = report.get('review_items', [])
    if review_items:
        lines.append(f"## 需要人工复听的片段（{len(review_items)} 个）\n")
        lines.append("| # | 时间 | 来源 | 问题类型 | 严重度 | 说明 |")
        lines.append("|---|------|------|----------|--------|------|")
        for i, item in enumerate(review_items, 1):
            source_label = {"signal": "信号", "ai": "AI", "ai_confirmed": "AI确认"}.get(item['source'], item['source'])
            sev_label = {"high": "🔴 HIGH", "medium": "🟡 MED", "low": "🟢 LOW"}.get(item['severity'], item['severity'])
            detail = item['detail'][:60] + "..." if len(item['detail']) > 60 else item['detail']
            lines.append(f"| {i} | {item['time_str']} | {source_label} | {item['type']} | {sev_label} | {detail} |")

        # 估算复听时间
        total_listen = len(review_items) * 5  # 每个点约 5 秒
        lines.append(f"\n> 只需复听以上 {len(review_items)} 个片段（约 {total_listen} 秒），无需听完整集。\n")
    else:
        lines.append("## ✅ 无需人工复听\n")
        lines.append("所有检测点均通过，音频质量良好。\n")

    # AI 误报分析（如有）
    if report.get('ai_summary'):
        ai = report['ai_summary']
        if ai.get('false_positives', 0) > 0:
            total_checked = ai.get('suspicious_clips', 0)
            fp = ai['false_positives']
            lines.append(f"## AI 复查结果\n")
            lines.append(f"- 复查 Layer 1 的 {total_checked} 个 HIGH 问题")
            lines.append(f"- ✅ 误报: {fp} 个（{fp/max(total_checked,1)*100:.0f}%）")
            lines.append(f"- ⚠️ 确认: {ai.get('confirmed_issues', 0)} 个\n")

    # 统计
    lines.append("## 统计\n")
    stats = report.get('signal_summary', {})
    lines.append(f"- 原始检测 issues: {stats.get('original_total', 'N/A')} 个")
    lines.append(f"- 播客模式过滤后: {stats.get('filtered_total', 'N/A')} 个")
    if review_items:
        high = sum(1 for r in review_items if r['severity'] == 'high')
        med = sum(1 for r in review_items if r['severity'] == 'medium')
        low = sum(1 for r in review_items if r['severity'] == 'low')
        lines.append(f"- HIGH: {high} | MEDIUM: {med} | LOW: {low}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Podcast QA report generator (Layer 3)")
    parser.add_argument("--signal", "-s", required=True, help="Layer 1 signal report JSON")
    parser.add_argument("--ai", "-a", help="Layer 2 AI report JSON (optional)")
    parser.add_argument("--output", "-o", required=True, help="Output combined report JSON")
    parser.add_argument("--summary", help="Output Markdown summary path")
    args = parser.parse_args()

    # 读取 Layer 1
    if not Path(args.signal).exists():
        print(f"❌ 找不到信号报告: {args.signal}")
        sys.exit(1)

    with open(args.signal) as f:
        signal_report = json.load(f)

    print(f"📋 Layer 1: {signal_report.get('summary', {}).get('total_issues', 0)} 原始 issues")

    # 播客模式重新计算
    signal_score, significant_issues = recalculate_signal_score(signal_report, podcast_mode=True)
    print(f"   播客模式过滤后: {len(significant_issues)} 个显著问题")
    print(f"   信号评分: {signal_score}/10")

    # 读取 Layer 2（如有）
    ai_report = None
    ai_score = None
    ai_evals = None
    if args.ai and Path(args.ai).exists():
        with open(args.ai) as f:
            ai_report = json.load(f)
        ai_score = ai_report.get('ai_score')
        ai_evals = ai_report.get('evaluations', [])
        print(f"📋 Layer 2: AI 评分 {ai_score}/10")

    # 合并评分
    overall = merge_scores(signal_score, ai_score)
    print(f"\n📊 综合评分: {overall}/10")

    # 收集需要复听的片段
    review_items = collect_review_items(significant_issues, ai_evals)
    print(f"   需要复听: {len(review_items)} 个片段")

    # 构建综合报告
    report = {
        "audio_file": signal_report.get('audio_file', ''),
        "duration_seconds": signal_report.get('duration_seconds', 0),
        "detected_cut_points": signal_report.get('detected_cut_points', 0),
        "signal_score": signal_score,
        "ai_score": ai_score,
        "overall_score": overall,
        "review_items": review_items,
        "signal_summary": {
            "original_total": signal_report.get('summary', {}).get('total_issues', 0),
            "filtered_total": len(significant_issues),
        },
        "ai_summary": ai_report.get('summary') if ai_report else None,
    }

    # 保存 JSON
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 报告已保存: {args.output}")

    # 生成 Markdown
    if args.summary:
        md = generate_markdown(report)
        with open(args.summary, 'w', encoding='utf-8') as f:
            f.write(md)
        print(f"✅ 摘要已保存: {args.summary}")
        print(f"\n{'='*50}")
        print(md)


if __name__ == "__main__":
    main()

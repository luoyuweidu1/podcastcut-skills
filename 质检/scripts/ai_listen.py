#!/usr/bin/env python3
"""
Layer 2: AI 听感评估 — 用 Gemini Audio API 评估剪辑质量

两种采样策略：
1. 全局采样 — 等间隔抽取 6 个 30s 片段，评估整体节奏和风格一致性
2. 可疑片段复查 — 对 Layer 1 标记的 HIGH 问题片段做 AI 二次确认，减少误报

需要 GEMINI_API_KEY 环境变量。

用法：
    python3 ai_listen.py --input podcast.mp3 --signal-report qa_signal_report.json --output qa_ai_report.json
    python3 ai_listen.py --input podcast.mp3 --output qa_ai_report.json   # 无 Layer 1 报告，仅全局采样
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Gemini prompt 模板（按 SKILL.md 定义）
EVAL_PROMPT_GLOBAL = """You are a professional podcast editor evaluating audio quality.
Listen carefully to this 30-second clip from a Chinese podcast and evaluate:

1. TRANSITION QUALITY (1-10): Does the audio sound natural throughout?
   - Is there an abrupt change in background noise or room tone?
   - Does the speaker's intonation flow naturally?
   - Are pauses between sentences/words at a natural duration?
   - Any clicks, pops, or discontinuities?

2. SPECIFIC ISSUES: List any moments that sound "off". For each issue, give the approximate seconds offset from the start of this clip and a brief description.

3. VERDICT: "pass" / "review_recommended" / "redo_recommended"

Respond in this exact JSON format (no markdown):
{
  "transition_score": 8,
  "issues": [
    {"time_offset": 12.5, "description": "Abrupt cut in speaker's sentence"}
  ],
  "verdict": "pass"
}

If there are no issues, use an empty array: "issues": []
Be strict but fair. Natural speech pauses and filler words are normal in podcasts."""

EVAL_PROMPT_SUSPICIOUS = """You are a professional podcast editor. A signal analysis tool flagged a potential edit quality issue at this location in a Chinese podcast.

The flagged issue: {issue_detail}

Listen carefully to this 10-second clip centered on the flagged point and evaluate:

1. Is this a REAL audio quality issue that a listener would notice? Or is it normal speech variation (natural pause, speaker change, emphasis)?

2. If it IS a real issue, rate severity 1-10 (10 = worst).

3. VERDICT: "confirmed" (real issue) / "false_positive" (normal, not an issue)

Respond in this exact JSON format (no markdown):
{{
  "is_real_issue": false,
  "severity": 0,
  "explanation": "This is a natural speaker change, not an edit artifact",
  "verdict": "false_positive"
}}"""


def extract_clip(input_path, start, duration, output_path):
    """用 ffmpeg atrim 提取音频片段为 WAV"""
    cmd = [
        'ffmpeg', '-v', 'quiet',
        '-i', input_path,
        '-af', f'atrim=start={start:.3f}:end={start + duration:.3f},asetpts=PTS-STARTPTS',
        '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        '-y', output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return False
    return os.path.exists(output_path) and os.path.getsize(output_path) > 0


def call_gemini(client, model, audio_bytes, prompt, max_retries=3):
    """调用 Gemini API 评估音频片段，带重试"""
    from google.genai import types

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=[
                    prompt,
                    types.Part.from_bytes(data=audio_bytes, mime_type="audio/wav")
                ]
            )
            return response.text
        except Exception as e:
            error_str = str(e)
            if 'RATE_LIMIT' in error_str or '429' in error_str:
                wait = (2 ** attempt) * 2  # 2, 4, 8 seconds
                print(f"  ⏳ Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            elif attempt < max_retries - 1:
                print(f"  ⚠️ API error (attempt {attempt + 1}): {error_str[:100]}")
                time.sleep(1)
                continue
            else:
                print(f"  ❌ API failed after {max_retries} attempts: {error_str[:100]}")
                return None
    return None


def parse_json_response(text):
    """从 Gemini 返回的文本中提取 JSON"""
    if not text:
        return None

    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试从 markdown 代码块中提取
    match = re.search(r'```(?:json)?\s*\n(.*?)\n```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 尝试找到 JSON 对象
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return None


def get_global_sample_times(duration, n_samples=6, clip_duration=30):
    """计算全局等间隔采样点"""
    if duration < clip_duration * 2:
        # 音频太短，只采一个中间点
        return [max(0, duration / 2 - clip_duration / 2)]

    # 去掉头尾各 10%，在中间 80% 等间隔采样
    margin = duration * 0.1
    usable = duration - 2 * margin
    step = usable / (n_samples + 1)

    times = []
    for i in range(1, n_samples + 1):
        t = margin + step * i - clip_duration / 2
        t = max(0, min(t, duration - clip_duration))
        times.append(round(t, 1))

    return times


def get_suspicious_clips(signal_report, max_clips=10):
    """从 Layer 1 报告中提取最严重的 HIGH issues"""
    issues = signal_report.get('issues', [])
    high_issues = [i for i in issues if i.get('severity') == 'high']

    # 按 metric 排序（能量比越高越可疑）
    high_issues.sort(key=lambda x: x.get('metric', 0), reverse=True)

    # 去重（相邻 5s 内的只保留最严重的）
    filtered = []
    for issue in high_issues:
        t = issue['timestamp']
        if not filtered or all(abs(t - f['timestamp']) > 5 for f in filtered):
            filtered.append(issue)
        if len(filtered) >= max_clips:
            break

    return filtered


def format_time(seconds):
    """格式化时间为 MM:SS"""
    m, s = divmod(int(seconds), 60)
    if m >= 60:
        h, m = divmod(m, 60)
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def main():
    parser = argparse.ArgumentParser(description="Podcast edit AI listening evaluation (Layer 2)")
    parser.add_argument("--input", "-i", required=True, help="Input audio file path")
    parser.add_argument("--signal-report", "-s", help="Layer 1 signal report JSON (optional)")
    parser.add_argument("--output", "-o", required=True, help="Output AI report JSON path")
    parser.add_argument("--model", "-m", default="gemini-2.5-flash", help="Gemini model (default: gemini-2.5-flash)")
    parser.add_argument("--global-samples", type=int, default=6, help="Number of global sample clips (default: 6)")
    parser.add_argument("--max-suspicious", type=int, default=10, help="Max suspicious clips to review (default: 10)")
    args = parser.parse_args()

    # 检查输入文件
    if not Path(args.input).exists():
        print(f"❌ 找不到音频文件: {args.input}")
        sys.exit(1)

    # 检查 API Key
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        # 尝试从 .env 文件读取
        env_path = Path(__file__).resolve().parent.parent.parent / '.env'
        if env_path.exists():
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('GEMINI_API_KEY='):
                        api_key = line.split('=', 1)[1].strip().strip('"').strip("'")
                        break

    if not api_key:
        print("❌ 未找到 GEMINI_API_KEY")
        print("   设置方法:")
        print("   1. export GEMINI_API_KEY='your-key'")
        print("   2. 或在 .env 文件中添加 GEMINI_API_KEY=your-key")
        sys.exit(1)

    # 初始化 Gemini client
    print("🤖 初始化 Gemini API...")
    from google import genai
    client = genai.Client(api_key=api_key)

    # 获取音频时长
    result = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', args.input],
        capture_output=True, text=True
    )
    duration = float(result.stdout.strip())
    print(f"📊 音频: {Path(args.input).name}")
    print(f"   时长: {format_time(duration)} ({duration:.1f}s)")
    print(f"   模型: {args.model}")
    print()

    # 读取 Layer 1 报告（如有）
    signal_report = None
    if args.signal_report and Path(args.signal_report).exists():
        with open(args.signal_report) as f:
            signal_report = json.load(f)
        high_count = signal_report.get('summary', {}).get('high', 0)
        print(f"📋 Layer 1 报告: {signal_report.get('summary', {}).get('total_issues', 0)} issues ({high_count} HIGH)")

    evaluations = []

    # ===== 策略 1: 全局采样 =====
    print(f"\n🎧 策略 1: 全局采样 ({args.global_samples} 个 30s 片段)")
    sample_times = get_global_sample_times(duration, args.global_samples, 30)
    print(f"   采样点: {', '.join(format_time(t) for t in sample_times)}")

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, start in enumerate(sample_times):
            clip_path = os.path.join(tmpdir, f"global_{idx}.wav")
            end = min(start + 30, duration)
            clip_dur = end - start

            print(f"   [{idx + 1}/{len(sample_times)}] {format_time(start)}-{format_time(end)} ...", end=" ", flush=True)

            if not extract_clip(args.input, start, clip_dur, clip_path):
                print("⚠️ 提取失败，跳过")
                continue

            with open(clip_path, 'rb') as f:
                audio_bytes = f.read()

            response_text = call_gemini(client, args.model, audio_bytes, EVAL_PROMPT_GLOBAL)
            parsed = parse_json_response(response_text)

            if parsed:
                # 将片段内的时间偏移转换为全局时间
                issues = []
                for issue in parsed.get('issues', []):
                    issues.append({
                        "time": round(start + issue.get('time_offset', 0), 1),
                        "description": issue.get('description', '')
                    })

                eval_entry = {
                    "strategy": "global_sampling",
                    "clip_range": [round(start, 1), round(end, 1)],
                    "transition_score": parsed.get('transition_score', 5),
                    "issues": issues,
                    "verdict": parsed.get('verdict', 'unknown'),
                }
                evaluations.append(eval_entry)

                verdict_emoji = {"pass": "✅", "review_recommended": "⚠️", "redo_recommended": "❌"}.get(eval_entry['verdict'], "❓")
                print(f"{verdict_emoji} score={eval_entry['transition_score']}/10, {len(issues)} issues")
            else:
                print("⚠️ 解析失败")
                evaluations.append({
                    "strategy": "global_sampling",
                    "clip_range": [round(start, 1), round(end, 1)],
                    "transition_score": None,
                    "issues": [],
                    "verdict": "parse_error",
                    "raw_response": (response_text or "")[:500]
                })

        # ===== 策略 2: 可疑片段复查 =====
        if signal_report:
            suspicious = get_suspicious_clips(signal_report, args.max_suspicious)
            if suspicious:
                print(f"\n🔍 策略 2: 可疑片段复查 ({len(suspicious)} 个 10s 片段)")

                for idx, issue in enumerate(suspicious):
                    t = issue['timestamp']
                    start = max(0, t - 5)
                    end = min(duration, t + 5)
                    clip_dur = end - start
                    clip_path = os.path.join(tmpdir, f"suspicious_{idx}.wav")

                    print(f"   [{idx + 1}/{len(suspicious)}] {format_time(t)} ({issue['detail'][:40]}) ...", end=" ", flush=True)

                    if not extract_clip(args.input, start, clip_dur, clip_path):
                        print("⚠️ 提取失败，跳过")
                        continue

                    with open(clip_path, 'rb') as f:
                        audio_bytes = f.read()

                    prompt = EVAL_PROMPT_SUSPICIOUS.format(issue_detail=issue['detail'])
                    response_text = call_gemini(client, args.model, audio_bytes, prompt)
                    parsed = parse_json_response(response_text)

                    if parsed:
                        verdict = parsed.get('verdict', 'unknown')
                        is_real = parsed.get('is_real_issue', False)

                        eval_entry = {
                            "strategy": "suspicious_review",
                            "clip_range": [round(start, 1), round(end, 1)],
                            "original_issue": {
                                "timestamp": t,
                                "type": issue['type'],
                                "detail": issue['detail'],
                                "metric": issue.get('metric')
                            },
                            "is_real_issue": is_real,
                            "severity": parsed.get('severity', 0),
                            "explanation": parsed.get('explanation', ''),
                            "verdict": verdict,
                        }
                        evaluations.append(eval_entry)

                        emoji = "⚠️" if is_real else "✅"
                        print(f"{emoji} {'真问题' if is_real else '误报'}: {parsed.get('explanation', '')[:50]}")
                    else:
                        print("⚠️ 解析失败")
            else:
                print("\n🔍 策略 2: 无 HIGH 级别问题需要复查")
        else:
            print("\n🔍 策略 2: 未提供 Layer 1 报告，跳过可疑片段复查")

    # ===== 计算综合 AI 评分 =====
    global_scores = [e['transition_score'] for e in evaluations
                     if e['strategy'] == 'global_sampling' and e.get('transition_score') is not None]

    suspicious_evals = [e for e in evaluations if e['strategy'] == 'suspicious_review']
    false_positives = sum(1 for e in suspicious_evals if not e.get('is_real_issue', True))
    confirmed = sum(1 for e in suspicious_evals if e.get('is_real_issue', False))

    ai_score = 5.0  # 默认
    if global_scores:
        ai_score = round(sum(global_scores) / len(global_scores), 1)
        # 如果有确认的真问题，扣分
        if confirmed > 0:
            ai_score = max(1.0, round(ai_score - confirmed * 0.5, 1))

    # 统计
    verdicts = [e.get('verdict', 'unknown') for e in evaluations if e['strategy'] == 'global_sampling']
    summary = {
        "total_clips": len(evaluations),
        "global_clips": len(global_scores),
        "suspicious_clips": len(suspicious_evals),
        "pass": verdicts.count('pass'),
        "review": verdicts.count('review_recommended'),
        "redo": verdicts.count('redo_recommended'),
        "false_positives": false_positives,
        "confirmed_issues": confirmed,
    }

    report = {
        "audio_file": str(Path(args.input).name),
        "model": args.model,
        "duration_seconds": round(duration, 1),
        "evaluations": evaluations,
        "ai_score": ai_score,
        "summary": summary,
    }

    # 保存报告
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # 打印摘要
    print(f"\n{'='*50}")
    print(f"AI 听感评估报告")
    print(f"{'='*50}")
    print(f"音频: {report['audio_file']}")
    print(f"模型: {args.model}")
    print(f"AI 评分: {ai_score} / 10")
    print()
    print(f"全局采样: {summary['global_clips']} 片段")
    print(f"  ✅ Pass: {summary['pass']}")
    print(f"  ⚠️ Review: {summary['review']}")
    print(f"  ❌ Redo: {summary['redo']}")
    if suspicious_evals:
        print(f"可疑复查: {summary['suspicious_clips']} 片段")
        print(f"  ✅ 误报: {summary['false_positives']}")
        print(f"  ⚠️ 确认: {summary['confirmed_issues']}")
    print(f"\n报告已保存: {args.output}")


if __name__ == "__main__":
    main()

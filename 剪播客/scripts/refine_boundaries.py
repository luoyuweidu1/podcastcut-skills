#!/usr/bin/env python3
"""
波形 onset detection — 在指定时间点附近搜索能量谷底，精修切割边界。

用法:
  python3 refine_boundaries.py --audio <path> --points '<JSON>'
  python3 refine_boundaries.py --audio <path> --points-file <path.json>

输入 JSON 格式:
  [
    {"time": 691.79, "search_window": 0.15, "direction": "both"},
    {"time": 45.32, "search_window": 0.10, "direction": "left"},
    ...
  ]

  - time: 待精修的时间点（秒）
  - search_window: 搜索窗口半径（秒），默认 0.15
  - direction: "left"=只向左搜索, "right"=只向右搜索, "both"=双向（默认）

输出 JSON:
  [
    {"original": 691.79, "refined": 691.82, "confidence": 0.85, "energy_drop_db": 4.2},
    ...
  ]

原理:
  1. 用 FFmpeg 解码目标区间音频为 raw PCM
  2. 计算 RMS 能量包络（5ms 帧，3 帧滑动平均）
  3. 在搜索窗口内找能量最低谷底
  4. 谷底必须 ≥3dB below local mean 才被认为是可靠的音节边界
  5. 不满足则返回原始时间点（confidence=0，fallback 到线性插值）
"""

import json
import subprocess
import sys
import os
import struct
import argparse

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# ── 常量 ──────────────────────────────────────────────
SAMPLE_RATE = 16000        # 解码采样率（16kHz 足够做能量分析）
FRAME_MS = 5               # 能量帧长度（毫秒）
SMOOTH_FRAMES = 3          # 滑动平均帧数
MIN_DROP_DB = 3.0          # 谷底最小深度（相对局部均值）
EXTRA_MARGIN = 0.05        # 额外解码余量（秒），避免边界效应


def decode_segment(audio_path, start_sec, duration_sec):
    """
    用 FFmpeg 解码指定区间为 16kHz mono s16le PCM。
    返回 numpy-like 的 float 采样数组。
    """
    cmd = [
        'ffmpeg', '-v', 'quiet',
        '-ss', f'{start_sec:.4f}',
        '-i', audio_path,
        '-t', f'{duration_sec:.4f}',
        '-ar', str(SAMPLE_RATE),
        '-ac', '1',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        'pipe:1'
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        print(f"  ⚠️ FFmpeg 解码失败: start={start_sec:.4f}, dur={duration_sec:.4f}", file=sys.stderr)
        return []

    raw = result.stdout
    # 解码 s16le 到 float [-1, 1]
    n_samples = len(raw) // 2
    if n_samples == 0:
        return []
    samples = struct.unpack(f'<{n_samples}h', raw)
    return [s / 32768.0 for s in samples]


def compute_rms_envelope(samples, frame_size, smooth_n):
    """
    计算 RMS 能量包络。

    Args:
        samples: float 采样数组
        frame_size: 每帧采样数
        smooth_n: 滑动平均窗口

    Returns:
        list of (frame_center_sample_idx, rms_value)
    """
    import math

    frames = []
    for i in range(0, len(samples) - frame_size + 1, frame_size):
        chunk = samples[i:i + frame_size]
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
        center = i + frame_size // 2
        frames.append((center, rms))

    if len(frames) < smooth_n:
        return frames

    # 滑动平均平滑
    smoothed = []
    half = smooth_n // 2
    for i in range(len(frames)):
        window_start = max(0, i - half)
        window_end = min(len(frames), i + half + 1)
        avg_rms = sum(f[1] for f in frames[window_start:window_end]) / (window_end - window_start)
        smoothed.append((frames[i][0], avg_rms))

    return smoothed


def find_energy_valley(envelope, search_start_idx, search_end_idx, direction, center_frame_idx=None):
    """
    在能量包络的指定范围内找最近的合格谷底（局部最小值）。

    策略：找出所有局部最小值 → 过滤深度 ≥ MIN_DROP_DB → 选最近的。
    如果没有合格谷底，返回最深的那个（低信心度）。

    Args:
        envelope: [(sample_idx, rms)] 已平滑的能量包络
        search_start_idx: 搜索起始帧索引
        search_end_idx: 搜索结束帧索引
        direction: "left", "right", "both"
        center_frame_idx: 原始时间点对应的帧索引（用于"最近"排序）

    Returns:
        (valley_frame_idx, confidence, energy_drop_db) or (None, 0, 0)
    """
    import math

    if search_end_idx <= search_start_idx or search_end_idx > len(envelope):
        return None, 0, 0

    search_frames = envelope[search_start_idx:search_end_idx]
    if not search_frames:
        return None, 0, 0

    rms_values = [f[1] for f in search_frames]
    mean_rms = sum(rms_values) / len(rms_values)

    if mean_rms <= 1e-10:
        return None, 0, 0

    # 方向过滤
    center_in_search = len(rms_values) // 2
    if direction == "left":
        active_range = range(0, center_in_search + 1)
    elif direction == "right":
        active_range = range(center_in_search, len(rms_values))
    else:
        active_range = range(0, len(rms_values))

    # 找所有局部最小值（比两侧邻居都低的帧）
    local_mins = []
    for i in active_range:
        rms = rms_values[i]
        left_ok = (i == 0) or (rms <= rms_values[i - 1])
        right_ok = (i == len(rms_values) - 1) or (rms <= rms_values[i + 1])
        if left_ok and right_ok:
            if rms <= 1e-10:
                drop_db = 60.0
            else:
                drop_db = 20 * math.log10(mean_rms / rms)
            global_idx = search_start_idx + i
            dist = abs(global_idx - center_frame_idx) if center_frame_idx is not None else i
            local_mins.append((global_idx, drop_db, dist))

    if not local_mins:
        return None, 0, 0

    # 分为合格（≥MIN_DROP_DB）和不合格
    qualified = [m for m in local_mins if m[1] >= MIN_DROP_DB]

    if qualified:
        # 选最近的合格谷底
        best = min(qualified, key=lambda m: m[2])
    else:
        # 没有合格的，选最深的（低信心度）
        best = max(local_mins, key=lambda m: m[1])

    valley_idx, drop_db, _ = best

    # 信心度
    if drop_db >= MIN_DROP_DB:
        confidence = min(1.0, 0.5 + (drop_db - MIN_DROP_DB) / (MIN_DROP_DB * 3))
    else:
        confidence = drop_db / MIN_DROP_DB * 0.4

    return valley_idx, confidence, drop_db


def refine_point(audio_path, point):
    """
    精修单个时间点。

    Args:
        audio_path: 音频文件路径
        point: {"time": float, "search_window": float, "direction": str}

    Returns:
        {"original": float, "refined": float, "confidence": float, "energy_drop_db": float}
    """
    time = point["time"]
    search_window = point.get("search_window", 0.15)
    direction = point.get("direction", "both")

    # 解码区间：time ± (search_window + margin)
    decode_start = max(0, time - search_window - EXTRA_MARGIN)
    decode_duration = (search_window + EXTRA_MARGIN) * 2

    samples = decode_segment(audio_path, decode_start, decode_duration)
    if not samples:
        return {"original": time, "refined": time, "confidence": 0, "energy_drop_db": 0}

    # 计算能量包络
    frame_size = SAMPLE_RATE * FRAME_MS // 1000  # 5ms @ 16kHz = 80 samples
    envelope = compute_rms_envelope(samples, frame_size, SMOOTH_FRAMES)

    if not envelope:
        return {"original": time, "refined": time, "confidence": 0, "energy_drop_db": 0}

    # 确定搜索范围（排除 margin 区域）
    search_start_sample = int(EXTRA_MARGIN * SAMPLE_RATE)
    search_end_sample = int((EXTRA_MARGIN + search_window * 2) * SAMPLE_RATE)

    # 映射到帧索引
    search_start_frame = 0
    search_end_frame = len(envelope)
    for i, (center, _) in enumerate(envelope):
        if center >= search_start_sample and search_start_frame == 0:
            search_start_frame = i
        if center >= search_end_sample:
            search_end_frame = i
            break

    # 原始时间点对应的帧索引（用于选最近谷底）
    center_sample = int((time - decode_start) * SAMPLE_RATE)
    center_frame = min(range(len(envelope)), key=lambda i: abs(envelope[i][0] - center_sample))

    # 找谷底（选最近的合格谷底）
    valley_frame_idx, confidence, drop_db = find_energy_valley(
        envelope, search_start_frame, search_end_frame, direction, center_frame
    )

    if valley_frame_idx is None or confidence < 0.3:
        return {
            "original": time,
            "refined": time,
            "confidence": round(confidence, 3),
            "energy_drop_db": round(drop_db, 2)
        }

    # 谷底帧的采样索引 → 绝对时间
    valley_sample = envelope[valley_frame_idx][0]
    refined_time = decode_start + valley_sample / SAMPLE_RATE

    return {
        "original": round(time, 4),
        "refined": round(refined_time, 4),
        "confidence": round(confidence, 3),
        "energy_drop_db": round(drop_db, 2)
    }


def main():
    parser = argparse.ArgumentParser(description='波形 onset detection 精修切割边界')
    parser.add_argument('--audio', required=True, help='音频文件路径')
    parser.add_argument('--points', help='待精修时间点 JSON 字符串')
    parser.add_argument('--points-file', help='待精修时间点 JSON 文件路径')
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(json.dumps({"error": f"音频文件不存在: {args.audio}"}))
        sys.exit(1)

    # 读取时间点
    if args.points_file:
        with open(args.points_file) as f:
            points = json.load(f)
    elif args.points:
        points = json.loads(args.points)
    else:
        print(json.dumps({"error": "必须提供 --points 或 --points-file"}))
        sys.exit(1)

    if not isinstance(points, list):
        points = [points]

    print(f"🔍 精修 {len(points)} 个切割点...", file=sys.stderr)

    results = []
    for i, pt in enumerate(points):
        result = refine_point(args.audio, pt)
        delta_ms = (result["refined"] - result["original"]) * 1000
        status = "✅" if result["confidence"] >= 0.5 else "⚠️"
        print(
            f"  {status} [{i+1}/{len(points)}] "
            f"{result['original']:.4f}s → {result['refined']:.4f}s "
            f"(Δ{delta_ms:+.1f}ms, conf={result['confidence']:.2f}, "
            f"drop={result['energy_drop_db']:.1f}dB)",
            file=sys.stderr
        )
        results.append(result)

    # 输出 JSON 到 stdout
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

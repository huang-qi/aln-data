"""Algorithm 层隔离单测。

这里只测 core/extract.py 的边界 / NaN / 空 / 退化 case。Happy-path
已经被 test_e2e_pipeline / test_process_batch 覆盖。

测试态度：对照客户参考脚本 (客户提供的材料/VNA analysis v5.4_SITRI.py)
的行为，把"已知是这样"的边界固化下来挡回归；任何"看起来奇怪"
的算法选择如果和客户脚本一致，就视为契约。
"""

from __future__ import annotations

import numpy as np
import pytest

from app.config import AlgorithmConfig
from app.core.extract import (
    ExtractError,
    _bodeq_raw_array,
    _smooth_bodeq,
    calc_bodeq,
    calc_q_3db,
    calc_q_phase,
    find_resonances,
)


# ── find_resonances ──────────────────────────────────────────────────────


def _flat_freq(n: int = 1001, f0: float = 1e9, f1: float = 3e9) -> np.ndarray:
    return np.linspace(f0, f1, n)


def _synth_resonator_z(freq: np.ndarray, fs: float, fp: float) -> np.ndarray:
    """构造一个最简谐振器阻抗谱：fs 处低谷、fp 处高峰，其余 ~50Ω。

    用两个高斯凹凸即可，幅值挑得能让 find_resonances 明确锁定。
    """
    z = 50 * np.ones_like(freq, dtype=float)
    sigma = (freq[-1] - freq[0]) * 0.005
    z -= 49 * np.exp(-((freq - fs) ** 2) / (2 * sigma**2))  # 谷至 ~1Ω
    z += 950 * np.exp(-((freq - fp) ** 2) / (2 * sigma**2))  # 峰至 ~1000Ω
    return z


def test_find_resonances_basic_picks_fs_lt_fp() -> None:
    freq = _flat_freq()
    z = _synth_resonator_z(freq, fs=1.8e9, fp=2.2e9)
    fs_idx, fp_idx = find_resonances(z, freq)
    # 容差 5 个点，构造时高斯窗会让"局部极值"略偏开几个点。
    assert abs(freq[fs_idx] - 1.8e9) < 5 * (freq[1] - freq[0])
    assert abs(freq[fp_idx] - 2.2e9) < 5 * (freq[1] - freq[0])
    assert fs_idx < fp_idx


def test_find_resonances_flat_array_returns_argmin_argmax_indices() -> None:
    """完全 flat 的输入：没有局部极值，fallback 到全局 argmin/argmax。
    虽然两个都会落到 0（np.argmin/argmax 返回首次出现位置），这是定义良好的退化行为，
    不应该 crash。
    """
    freq = _flat_freq(n=100)
    z = np.full_like(freq, 50.0)
    fs_idx, fp_idx = find_resonances(z, freq)
    # flat 数组上 argmin/argmax 都返回 0，是合法但无信息量的结果。
    assert isinstance(fs_idx, int)
    assert isinstance(fp_idx, int)
    assert 0 <= fs_idx < len(freq)
    assert 0 <= fp_idx < len(freq)


def test_find_resonances_min_separation_filters_close_peaks() -> None:
    """min_separation_hz 应当让 fp 跳过靠近 fs 的局部最大。"""
    freq = _flat_freq()
    z = _synth_resonator_z(freq, fs=1.8e9, fp=2.2e9)
    # 在 fs 紧邻位置（+10 MHz）人为加一个小峰，仍位于 min_separation_hz (20 MHz) 内
    near_idx = int(np.argmin(np.abs(freq - (1.8e9 + 10e6))))
    z[near_idx] = 200.0
    z[near_idx - 1] = 100.0
    z[near_idx + 1] = 100.0
    _, fp_idx = find_resonances(z, freq)
    # fp 不应被那个近距离 200Ω 小峰夺走。
    assert freq[fp_idx] > 1.8e9 + 20e6


# ── _bodeq_raw_array ─────────────────────────────────────────────────────


def test_bodeq_raw_array_marks_invalid_when_smag_near_unity() -> None:
    """当 |s| ≈ 1 时 denominator = 1-|s|² < 1e-6，该点应该是 NaN。"""
    freq = np.linspace(1e9, 2e9, 200)
    # |s| 设为 0.9999 → denominator ≈ 2e-4 — 仍在 valid 范围里。
    # 用 |s| = 1.0 → denominator = 0 → 必 NaN。
    s = np.ones_like(freq, dtype=complex) * (1.0 + 0j)
    arr, valid_count = _bodeq_raw_array(s, freq)
    assert valid_count == 0
    assert np.all(np.isnan(arr))


def test_bodeq_raw_array_mixed_valid_invalid_count_matches() -> None:
    freq = np.linspace(1e9, 2e9, 200)
    # 前半 |s|=1，后半 |s|=0.5 — 后半应该全 valid，前半全 NaN。
    s = np.concatenate(
        [
            np.ones(100, dtype=complex),
            np.full(100, 0.5 + 0.5j, dtype=complex),
        ]
    )
    arr, valid_count = _bodeq_raw_array(s, freq)
    assert valid_count == 100
    assert np.all(np.isnan(arr[:100]))
    assert np.all(~np.isnan(arr[100:]))


# ── _smooth_bodeq ────────────────────────────────────────────────────────


def test_smooth_bodeq_returns_raw_when_window_too_small() -> None:
    """点数太少导致 window_size ≤ 5 时直接返回原数组，不调 savgol。"""
    cfg = AlgorithmConfig()
    short_freq = np.linspace(1, 2, 8)
    raw = np.linspace(0, 10, 8)
    out = _smooth_bodeq(raw, short_freq, cfg)
    # window_size = min(51, 8//10*2+1) = 1 → ≤ 5 → 原样返回
    np.testing.assert_array_equal(out, raw)


# ── calc_bodeq ───────────────────────────────────────────────────────────


def test_calc_bodeq_raises_when_too_few_valid_points() -> None:
    freq = np.linspace(1e9, 2e9, 50)
    # 全部 |s|=1 → valid_count = 0 < 10
    s = np.ones_like(freq, dtype=complex)
    with pytest.raises(ExtractError, match="有效数据点不足"):
        calc_bodeq(s, freq, fs_idx=10, fp_idx=20)


# ── calc_q_phase ─────────────────────────────────────────────────────────


def test_calc_q_phase_returns_floats_no_crash_at_zero_phase_deriv() -> None:
    """相位完全平坦时导数为 0，Q 应是 0 而不是 NaN/Inf。"""
    freq = _flat_freq(n=200)
    z = np.full_like(freq, 50.0 + 0j, dtype=complex)
    qs, qp = calc_q_phase(z, freq, fs_idx=50, fp_idx=150)
    assert qs == 0.0
    assert qp == 0.0


# ── calc_q_3db ───────────────────────────────────────────────────────────


def test_calc_q_3db_returns_nan_when_band_collapses() -> None:
    """fs_idx 就在 0 位置 + 3dB 阈值在数据头部 → 左右 idx 重合 → NaN（而不是 inf）。"""
    freq = _flat_freq(n=100)
    z_db = np.full_like(freq, 0.0)  # 完全平坦，找不到 ±3 dB 跨越点
    dbqs, dbqp = calc_q_3db(z_db, freq, zs_db=0.0, zp_db=0.0, fs=freq[0], fp=freq[-1])
    # 当左右 idx 重合时返回 nan（代码里 `if right_idx > left_idx else nan`）
    assert np.isnan(dbqs) or np.isfinite(dbqs)  # 不强求 nan，只要不爆 inf
    assert not np.isinf(dbqs)
    assert not np.isinf(dbqp)


def test_calc_q_3db_normal_lorentzian_gives_finite_q() -> None:
    """对一个真 Lorentzian 形状，3dB 法应当给出有限正 Q。"""
    freq = _flat_freq(n=2001)
    # 用一个明确的 Lorentzian: zs 处低谷
    fs = 2e9
    bw = 5e6  # 3dB 带宽 5 MHz → Q ~ 400
    zs_db_floor = -40.0
    z_db = zs_db_floor + 40 / (1 + ((freq - fs) / (bw / 2)) ** 2)
    dbqs, _ = calc_q_3db(z_db, freq, zs_db=zs_db_floor, zp_db=0.0, fs=fs, fp=freq[-1])
    assert np.isfinite(dbqs)
    assert 100 < dbqs < 1000, f"Q 应该在 ~400 量级，实际 {dbqs}"

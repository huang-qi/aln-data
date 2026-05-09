"""ShortOpen de-embedding 封装。

来源：客户 de.py 第 159-166 行 + scikit-rf ShortOpen 校准类。

v1 默认关闭（用户决策），但接口和实现保留。
"""

from __future__ import annotations

from pathlib import Path

import skrf as rf
from skrf.calibration.deembedding import ShortOpen


def deembed(
    dut_path: str | Path,
    open_path: str | Path,
    short_path: str | Path,
    out_path: str | Path,
) -> Path:
    """对单个 DUT s1p 做 ShortOpen 去嵌，写出去嵌后的 s1p。

    返回 out_path（Path 对象）。
    """
    dut = rf.Network(str(dut_path))
    op = rf.Network(str(open_path))
    sh = rf.Network(str(short_path))

    real_dut = ShortOpen(dummy_short=sh, dummy_open=op).deembed(dut)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    real_dut.write_touchstone(str(out_path).replace(".s1p", ""))
    return out_path

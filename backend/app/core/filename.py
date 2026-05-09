"""文件名解析。

来源：客户脚本 extract_device_key / extract_coord / extract_xy_from_coord / extract_keywords。

支持的命名格式：
- DUT s2p:    "17_E6-1_X0Y0N18_Fail.s2p"
- DUT s1p:    "<原文件名>_S11.s1p" / "<原文件名>_S22.s1p"
- 老格式 s1p: "S11_2_E6-1_X0Y0N18.s1p"
- 校准文件:    含 "OPEN" 或 "SHORT"
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

PortType = Literal["S11", "S22"]

_MARK_RE = re.compile(r"([A-Za-z]+\d+-\d+)")
_COORD_RE = re.compile(r"X([+-]?\d+)Y([+-]?\d+)", re.IGNORECASE)
_PORT_SUFFIX_RE = re.compile(r"_(S\d{2})(?:\.s1p)?$", re.IGNORECASE)
_PORT_PREFIX_RE = re.compile(r"^(S\d{2})(?:_\d+)?_", re.IGNORECASE)
_OPEN_RE = re.compile(r"\bOPEN\b", re.IGNORECASE)
_SHORT_RE = re.compile(r"\bSHORT\b", re.IGNORECASE)


@dataclass(frozen=True)
class ParsedFilename:
    """从文件名提取的结构化信息。任何字段都可能为 None。"""

    name: str
    mark: str | None
    coord: str | None  # 如 "X-1Y2"
    x: int | None
    y: int | None
    port: PortType | None  # 'S11' / 'S22' / None（s2p 文件未拆分时为 None）
    pf: Literal["Y", "N"]  # 'Y' = 含 Fail 标记
    is_open: bool
    is_short: bool

    @property
    def is_calibration(self) -> bool:
        return self.is_open or self.is_short


def parse_filename(name: str) -> ParsedFilename:
    """解析文件名，返回结构化字段。"""
    return ParsedFilename(
        name=name,
        mark=extract_mark(name),
        coord=extract_coord(name),
        x=extract_xy(name)[0],
        y=extract_xy(name)[1],
        port=extract_port(name),
        pf=extract_pf(name),
        is_open=bool(_OPEN_RE.search(name)),
        is_short=bool(_SHORT_RE.search(name)),
    )


def extract_mark(name: str) -> str | None:
    """提取 mark，如 'A1-1' / 'AA12-3'。返回原大小写。"""
    m = _MARK_RE.search(name)
    return m.group(1) if m else None


def extract_coord(name: str) -> str | None:
    """提取归一化的坐标字符串，如 'X-1Y2'（去前导零）。"""
    m = _COORD_RE.search(name)
    if not m:
        return None
    x = m.group(1).lstrip("+").lstrip("0") or "0"
    y = m.group(2).lstrip("+").lstrip("0") or "0"
    if x.startswith("-0") and len(x) > 2:
        x = "-" + x[2:]
    if y.startswith("-0") and len(y) > 2:
        y = "-" + y[2:]
    return f"X{x}Y{y}"


def extract_xy(name: str) -> tuple[int | None, int | None]:
    """提取 X、Y 整数值。"""
    m = _COORD_RE.search(name)
    if not m:
        return None, None
    try:
        return int(m.group(1)), int(m.group(2))
    except ValueError:
        return None, None


def extract_port(name: str) -> PortType | None:
    """识别端口类型（S11 / S22）。"""
    m = _PORT_SUFFIX_RE.search(name)
    if m:
        port = m.group(1).upper()
        if port in ("S11", "S22"):
            return port  # type: ignore[return-value]
    m = _PORT_PREFIX_RE.match(name)
    if m:
        port = m.group(1).upper()
        if port in ("S11", "S22"):
            return port  # type: ignore[return-value]
    return None


def extract_pf(name: str) -> Literal["Y", "N"]:
    """检查是否含 Fail 标记。'Y' = 含 Fail。"""
    return "Y" if "Fail" in name else "N"

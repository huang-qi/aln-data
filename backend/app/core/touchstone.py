"""S2P → S1P 拆分。

来源：客户脚本 split_header_data / modify_header / extract_s11_data / extract_s22_data /
        write_output_file / process_s2p_file（27-1196 行去重后版本）。

S2P 文件每行：freq + S11_re + S11_im + S21_re + S21_im + S12_re + S12_im + S22_re + S22_im
- S11 拆分：保留前 3 列（freq, S11_re, S11_im）
- S22 拆分：保留第 1 列和最后 2 列（freq, S22_re, S22_im）
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SplitResult:
    s11_path: Path
    s22_path: Path


def split_s2p_to_s1p(
    s2p_path: str | Path,
    out_dir_s11: str | Path,
    out_dir_s22: str | Path,
) -> SplitResult:
    """把一个 .s2p 文件拆成 S11 和 S22 两个 .s1p 文件。

    返回两个输出文件路径。会创建 out_dir_s11 / out_dir_s22 目录。
    """
    s2p_path = Path(s2p_path)
    out_dir_s11 = Path(out_dir_s11)
    out_dir_s22 = Path(out_dir_s22)
    out_dir_s11.mkdir(parents=True, exist_ok=True)
    out_dir_s22.mkdir(parents=True, exist_ok=True)

    stem = s2p_path.stem
    s11_path = out_dir_s11 / f"{stem}_S11.s1p"
    s22_path = out_dir_s22 / f"{stem}_S22.s1p"

    with open(s2p_path) as f:
        lines = f.readlines()

    header, data = _split_header_data(lines)
    s11_header = _modify_header(header, "S11")
    s22_header = _modify_header(header, "S22")
    s11_data = _extract_s11(data)
    s22_data = _extract_s22(data)

    _write(s11_path, s11_header, s11_data)
    _write(s22_path, s22_header, s22_data)

    return SplitResult(s11_path=s11_path, s22_path=s22_path)


def _split_header_data(content: list[str]) -> tuple[list[str], list[str]]:
    header: list[str] = []
    data: list[str] = []
    header_ended = False
    for line in content:
        if not header_ended:
            header.append(line)
            if not line.startswith(("!", "#")) and line.strip():
                header_ended = True
        else:
            data.append(line)
    return header, data


def _modify_header(header: list[str], parameter: str) -> list[str]:
    new_header: list[str] = []
    if len(header) >= 2:
        new_header.extend(header[:2])

    for line in header:
        if line.strip().startswith(f"!Correction: {parameter}("):
            new_header.append(line)
            break

    for line in header:
        if line.strip().startswith(("!S2P File:", "!S1P File:")):
            new_line = line.replace("S2P", "S1P").replace(
                "S11, S21, S12, S22", parameter
            )
            new_header.append(new_line)
            break

    option_line = unit_line = None
    for line in header:
        stripped = line.strip()
        if stripped.startswith("#"):
            option_line = line
        elif stripped.lower().startswith("hz"):
            unit_line = line
    if option_line:
        new_header.append(option_line)
    if unit_line:
        new_header.append(unit_line)
    return new_header


def _extract_s11(data_lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in data_lines:
        parts = line.strip().split()
        if len(parts) >= 3:
            out.append(f"{parts[0]} {parts[1]} {parts[2]}\n")
    return out


def _extract_s22(data_lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in data_lines:
        parts = line.strip().split()
        if len(parts) >= 9:
            out.append(f"{parts[0]} {parts[-2]} {parts[-1]}\n")
    return out


def _write(path: Path, header: list[str], data: list[str]) -> None:
    with open(path, "w") as f:
        f.writelines(header)
        f.writelines(data)

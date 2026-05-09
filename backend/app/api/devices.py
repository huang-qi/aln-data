"""单器件曲线接口：S 参数 / BodeQ。"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

import numpy as np
import skrf
from fastapi import APIRouter, HTTPException, Query

from app.api.deps import DbSession
from app.config import get_settings
from app.models import Device

router = APIRouter(prefix="/devices", tags=["devices"])

_PARAM_CHOICES = ("s11_db", "s11_phase", "s11_re_im", "z_mag_db", "z_phase")


def _resolve_sparam_path(rel_or_abs: str, batch_no: str | None = None) -> Path:
    settings = get_settings()
    p = Path(rel_or_abs)
    if p.is_absolute():
        return p
    base = settings.files_dir
    if batch_no:
        base = base / batch_no
    return base / p


@router.get("/{device_id}/sparam")
def device_sparam(
    device_id: int,
    db: DbSession,
    param: Annotated[str, Query()] = "s11_db",
) -> dict[str, Any]:
    if param not in _PARAM_CHOICES:
        raise HTTPException(
            status_code=400, detail=f"param 必须是 {','.join(_PARAM_CHOICES)} 之一"
        )

    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"器件 {device_id} 不存在")
    if not device.s_param_path:
        raise HTTPException(status_code=404, detail="该器件没有 S 参数文件")

    batch_no = device.batch.batch_no if device.batch else None
    path = _resolve_sparam_path(device.s_param_path, batch_no=batch_no)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"S 参数文件不存在: {path}")

    try:
        net = skrf.Network(str(path))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"读取 S 参数失败: {exc!s}") from exc

    freq_ghz = (net.f / 1e9).tolist()
    s = net.s[:, 0, 0]

    if param == "s11_db":
        values = (20 * np.log10(np.maximum(np.abs(s), 1e-12))).tolist()
    elif param == "s11_phase":
        values = [float(v) for v in np.degrees(np.unwrap(np.angle(s)))]
    elif param == "s11_re_im":
        return {
            "device_id": device_id,
            "freq_ghz": freq_ghz,
            "values_re": np.real(s).tolist(),
            "values_im": np.imag(s).tolist(),
            "param": param,
            "file_path": device.s_param_path,
        }
    elif param == "z_mag_db":
        z0 = net.z0[0, 0]
        z = z0 * (1 + s) / (1 - s)
        values = (20 * np.log10(np.maximum(np.abs(z), 1e-12))).tolist()
    elif param == "z_phase":
        z0 = net.z0[0, 0]
        z = z0 * (1 + s) / (1 - s)
        values = [float(v) for v in np.degrees(np.unwrap(np.angle(z)))]
    else:
        raise HTTPException(status_code=400, detail="param 不支持")

    return {
        "device_id": device_id,
        "freq_ghz": freq_ghz,
        "values": values,
        "param": param,
        "file_path": device.s_param_path,
    }


@router.get("/{device_id}/bodeq")
def device_bodeq(device_id: int, db: DbSession) -> dict[str, Any]:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"器件 {device_id} 不存在")
    raise HTTPException(
        status_code=501,
        detail="BodeQ 曲线接口暂未实现（待算法层暴露 compute_bodeq 现读接口）",
    )

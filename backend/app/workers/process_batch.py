"""上传 zip → 解压 → 拆 S2P → 提参 → 入库 的 Celery 主任务。"""

from __future__ import annotations

import logging
import shutil
import zipfile
from pathlib import Path
from typing import Any

from celery import Task
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deembed import deembed
from app.core.extract import ExtractError, extract_resonator_params
from app.core.filename import parse_filename
from app.core.mapping import load_mapping
from app.core.touchstone import split_s2p_to_s1p
from app.db import SessionLocal
from app.models import Batch, Device, Mapping
from app.workers import celery_app
from app.workers.progress import ProgressPublisher

logger = logging.getLogger(__name__)

INSERT_CHUNK = 500


@celery_app.task(bind=True, name="aln.process_batch")
def process_batch_task(
    self: Task,
    upload_task_id: int,
    zip_path: str,
    batch_no: str,
    mapping_id: int,
    f_start_ghz: float | None = None,
    f_end_ghz: float | None = None,
    deembed_enabled: bool = False,
    process_type: str = "S1P",
) -> dict[str, Any]:
    """处理一个上传任务的完整管线。

    输入由 API 准备：upload_tasks/batches 行已 pending；ZIP 已落到 uploads_dir。
    返回 {"batch_id", "device_count", "failures"}。失败抛异常并标 upload_tasks=failed。
    """
    publisher = ProgressPublisher(upload_task_id)
    settings = get_settings()
    db: Session = SessionLocal()

    try:
        publisher.start(db, msg="解压中…")

        # 1. 找到 batch 行（API 已建 pending）
        batch = db.scalar(select(Batch).where(Batch.batch_no == batch_no))
        if batch is None:
            raise RuntimeError(f"batches 表无 batch_no={batch_no} 的预占行")

        # 2. 找 mapping 文件
        mapping_row = db.get(Mapping, mapping_id)
        if mapping_row is None:
            raise RuntimeError(f"mappings 表无 id={mapping_id}")
        mapping_dict = load_mapping(mapping_row.file_path)

        # 3. 解压 ZIP 到 files_dir/<batch_no>/
        target_dir = settings.files_dir / batch_no
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(target_dir)

        # 4. 扫描 .s2p 文件并拆 S11/S22
        s2p_files = sorted(p for p in target_dir.rglob("*.s2p") if p.is_file())
        s11_dir = target_dir / "S11"
        s22_dir = target_dir / "S22"

        # 校准文件分类（用于可选 de-embed）
        cal_open: dict[str, Path] = {}
        cal_short: dict[str, Path] = {}
        dut_s2p: list[Path] = []
        for p in s2p_files:
            parsed = parse_filename(p.name)
            if parsed.is_open:
                cal_open[p.parent.as_posix()] = p
            elif parsed.is_short:
                cal_short[p.parent.as_posix()] = p
            else:
                dut_s2p.append(p)

        publisher.update(
            db,
            progress_pct=5,
            progress_msg=f"解压完成，发现 {len(dut_s2p)} 个 DUT 文件",
        )

        s1p_pairs: list[tuple[Path, Path]] = []  # (s11_path, s22_path)
        for s2p in dut_s2p:
            split = split_s2p_to_s1p(s2p, out_dir_s11=s11_dir, out_dir_s22=s22_dir)
            s1p_pairs.append((split.s11_path, split.s22_path))

        # 可选去嵌：把 s1p_pairs 替换为去嵌后的 .s1p 路径
        if deembed_enabled:
            s1p_pairs = _run_deembed(
                s1p_pairs=s1p_pairs,
                cal_open=cal_open,
                cal_short=cal_short,
                target_dir=target_dir,
            )

        # 5. 提参 + 收集 Device 行
        all_s1p: list[Path] = []
        for s11, s22 in s1p_pairs:
            all_s1p.extend([s11, s22])

        total = len(all_s1p)
        if total == 0:
            raise RuntimeError("ZIP 解压后未发现 .s2p 文件")

        wafer = _wafer_from_batch_no(batch_no)
        device_rows: list[dict[str, Any]] = []
        failures: list[str] = []
        last_pct = 5

        for i, s1p in enumerate(all_s1p, start=1):
            try:
                row = extract_resonator_params(
                    s1p,
                    mapping=mapping_dict,
                    wafer=wafer,
                    s_param_relpath=str(s1p.relative_to(target_dir)),
                    deembedded=deembed_enabled,
                    f_start_ghz=f_start_ghz,
                    f_end_ghz=f_end_ghz,
                )
                payload = row.model_dump()
                payload["batch_id"] = batch.id
                device_rows.append(payload)
            except (ExtractError, Exception) as exc:  # 单文件失败不阻塞
                failures.append(f"{s1p.name}: {exc}")
                logger.warning("提参失败 %s: %s", s1p.name, exc)

            # 每 5% 或每 100 个文件 推进度
            pct = 5 + int(90 * i / total)
            if pct != last_pct and (pct - last_pct >= 5 or i % 100 == 0 or i == total):
                publisher.update(
                    db,
                    progress_pct=pct,
                    progress_msg=f"已处理 {i}/{total}，失败 {len(failures)}",
                )
                last_pct = pct

            # 分批 flush 入库（每 INSERT_CHUNK 行）
            if len(device_rows) >= INSERT_CHUNK:
                _bulk_insert_devices(db, device_rows)
                device_rows = []

        # 尾批
        if device_rows:
            _bulk_insert_devices(db, device_rows)

        # 6. 统计 + 收尾
        device_count = (
            db.scalar(select(func.count(Device.id)).where(Device.batch_id == batch.id)) or 0
        )

        db.execute(
            update(Batch)
            .where(Batch.id == batch.id)
            .values(
                device_count=device_count,
                file_path=str(target_dir),
                f_start_ghz=f_start_ghz,
                f_end_ghz=f_end_ghz,
                deembedded=deembed_enabled,
                process_type=process_type,
                task_id=upload_task_id,
            )
        )
        db.commit()

        publisher.done(db, batch_id=batch.id, device_count=device_count)
        return {
            "batch_id": batch.id,
            "device_count": device_count,
            "failures": len(failures),
            "failure_samples": failures[:5],
        }

    except Exception as exc:
        logger.exception("process_batch_task fatal")
        try:
            publisher.fail(db, error_msg=str(exc))
        finally:
            pass
        raise
    finally:
        db.close()


def _bulk_insert_devices(db: Session, rows: list[dict[str, Any]]) -> None:
    """批量插入 Device，避免逐条 ORM 开销。"""
    if not rows:
        return
    db.bulk_insert_mappings(Device, rows)
    db.commit()


def _wafer_from_batch_no(batch_no: str) -> int | None:
    """从 batch_no 中尝试提取尾段数字作 wafer 编号；解析不出返回 None。"""
    import re

    m = re.search(r"\.(\d+)$", batch_no)
    if m:
        try:
            return int(m.group(1))
        except ValueError:
            return None
    return None


class DeembedError(RuntimeError):
    """De-embedding 流程错误（缺校准件、单文件去嵌失败等）。"""


def _run_deembed(
    s1p_pairs: list[tuple[Path, Path]],
    cal_open: dict[str, Path],
    cal_short: dict[str, Path],
    target_dir: Path,
) -> list[tuple[Path, Path]]:
    """对每对 (S11, S22) s1p 用同目录 OPEN/SHORT s2p 做去嵌。

    步骤：
    1. 把每个 OPEN.s2p / SHORT.s2p 拆成 _S11.s1p / _S22.s1p
    2. 对每个 DUT 的 S11.s1p、S22.s1p 分别用对应端口的 OPEN/SHORT 去嵌
    3. 写出 *_de.s1p，返回新的 (s11_de, s22_de) 列表

    缺校准件直接 raise DeembedError，**不静默跳过**。
    """
    if not cal_open or not cal_short:
        raise DeembedError(
            "已启用 De-embedding 但 ZIP 内未找到 OPEN/SHORT 校准 .s2p 文件；"
            "请确认压缩包包含同名 OPEN/SHORT 文件，或在上传时取消 De-embed 选项。"
        )

    cal_s11_dir = target_dir / "cal_S11"
    cal_s22_dir = target_dir / "cal_S22"
    de_s11_dir = target_dir / "S11_de"
    de_s22_dir = target_dir / "S22_de"

    # 1. 拆所有 OPEN/SHORT.s2p（按目录唯一）
    open_s11: dict[str, Path] = {}
    open_s22: dict[str, Path] = {}
    short_s11: dict[str, Path] = {}
    short_s22: dict[str, Path] = {}
    for dirkey, op in cal_open.items():
        split = split_s2p_to_s1p(op, out_dir_s11=cal_s11_dir, out_dir_s22=cal_s22_dir)
        open_s11[dirkey] = split.s11_path
        open_s22[dirkey] = split.s22_path
    for dirkey, sh in cal_short.items():
        split = split_s2p_to_s1p(sh, out_dir_s11=cal_s11_dir, out_dir_s22=cal_s22_dir)
        short_s11[dirkey] = split.s11_path
        short_s22[dirkey] = split.s22_path

    def _pick(d: dict[str, Path], dut_path: Path) -> Path | None:
        """优先匹配 DUT 同 zip 子目录的校准件；若 DUT 是从 S11/S22/ 输出目录来的，
        退回到任意一个校准件（v1 简化：通常一个 zip 只有一组 OPEN/SHORT）。"""
        return next(iter(d.values())) if d else None

    # 2. 逐对 DUT 去嵌
    new_pairs: list[tuple[Path, Path]] = []
    for s11_path, s22_path in s1p_pairs:
        op11 = _pick(open_s11, s11_path)
        sh11 = _pick(short_s11, s11_path)
        op22 = _pick(open_s22, s22_path)
        sh22 = _pick(short_s22, s22_path)
        if not (op11 and sh11 and op22 and sh22):
            raise DeembedError(
                f"无法为 {s11_path.name} / {s22_path.name} 找到匹配的 OPEN/SHORT 校准件"
            )

        s11_de = de_s11_dir / s11_path.name.replace(".s1p", "_de.s1p")
        s22_de = de_s22_dir / s22_path.name.replace(".s1p", "_de.s1p")
        try:
            deembed(s11_path, op11, sh11, s11_de)
            deembed(s22_path, op22, sh22, s22_de)
        except Exception as exc:  # pragma: no cover - skrf 异常透传
            raise DeembedError(f"De-embedding 失败 {s11_path.name}: {exc}") from exc
        new_pairs.append((s11_de, s22_de))

    return new_pairs

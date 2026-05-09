"""上传接口：POST /api/uploads。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select

from app.api.deps import DbSession
from app.config import get_settings
from app.models import Batch, Mapping, UploadTask
from app.schemas.upload import UploadAccepted

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("", response_model=UploadAccepted, status_code=status.HTTP_202_ACCEPTED)
def create_upload(
    db: DbSession,
    file: Annotated[UploadFile, File(...)],
    mapping_id: Annotated[int, Form(...)],
    f_start_ghz: Annotated[float | None, Form()] = None,
    f_end_ghz: Annotated[float | None, Form()] = None,
    process_type: Annotated[str, Form()] = "BOTH",
    deembed: Annotated[bool, Form()] = False,
) -> UploadAccepted:
    settings = get_settings()

    if not file.filename:
        raise HTTPException(status_code=400, detail="未提供文件")
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 zip 文件")
    if process_type not in ("S1P", "S2P", "BOTH"):
        raise HTTPException(
            status_code=400, detail="process_type 必须是 S1P / S2P / BOTH 之一"
        )

    batch_no = Path(file.filename).stem
    if not batch_no:
        raise HTTPException(status_code=400, detail="文件名为空，无法解析批次号")

    mapping = db.get(Mapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=422, detail=f"对照表 {mapping_id} 不存在")

    existing = db.scalar(select(Batch).where(Batch.batch_no == batch_no))
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"批次 {batch_no} 已存在")

    month_dir = settings.uploads_dir / datetime.now(UTC).strftime("%Y-%m")
    month_dir.mkdir(parents=True, exist_ok=True)
    saved_name = f"{uuid.uuid4().hex}.zip"
    saved_path = month_dir / saved_name

    max_bytes = settings.UPLOAD_MAX_GB * 1024**3
    written = 0
    with saved_path.open("wb") as out:
        while True:
            chunk = file.file.read(8 * 1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                out.close()
                saved_path.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"文件超过上限 {settings.UPLOAD_MAX_GB} GB",
                )
            out.write(chunk)

    task = UploadTask(
        batch_no=batch_no,
        status="pending",
        progress_pct=0,
        progress_msg="排队中",
    )
    db.add(task)
    db.flush()

    batch = Batch(
        batch_no=batch_no,
        mapping_id=mapping_id,
        f_start_ghz=f_start_ghz,
        f_end_ghz=f_end_ghz,
        deembedded=bool(deembed),
        process_type=process_type,
        file_path=str(saved_path),
        device_count=0,
        task_id=task.id,
    )
    db.add(batch)
    db.commit()
    db.refresh(task)

    celery_task_id: str | None = None
    try:
        from app.workers.process_batch import process_batch_task

        result = process_batch_task.delay(
            upload_task_id=task.id,
            zip_path=str(saved_path),
            batch_no=batch_no,
            mapping_id=mapping_id,
            f_start_ghz=f_start_ghz,
            f_end_ghz=f_end_ghz,
            deembed_enabled=bool(deembed),
            process_type=process_type,
        )
        celery_task_id = result.id
    except ImportError:
        celery_task_id = None

    if celery_task_id:
        task.celery_task_id = celery_task_id
        db.commit()

    return UploadAccepted(
        task_id=str(task.id),
        batch_no=batch_no,
        status=task.status,
        stream_url=f"/api/tasks/{task.id}/stream",
    )


@router.post("/chunk", status_code=status.HTTP_501_NOT_IMPLEMENTED)
def chunk_upload() -> dict:
    raise HTTPException(status_code=501, detail="分块上传暂未实现")

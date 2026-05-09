"""进度发布工具：同时更新 upload_tasks 行 + Redis pub/sub。"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from redis import Redis
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import UploadTask


class ProgressPublisher:
    """封装 Redis pub/sub + DB 更新两件事。"""

    def __init__(self, task_id: int) -> None:
        self.task_id = task_id
        self.channel = f"task:{task_id}"
        self._redis: Redis = Redis.from_url(get_settings().REDIS_URL, decode_responses=True)

    def _publish(self, payload: dict[str, Any]) -> None:
        try:
            self._redis.publish(self.channel, json.dumps(payload))
        except Exception:
            # Redis 故障不应影响主流程
            pass

    def update(self, db: Session, progress_pct: int, progress_msg: str) -> None:
        progress_pct = max(0, min(100, int(progress_pct)))
        db.execute(
            update(UploadTask)
            .where(UploadTask.id == self.task_id)
            .values(progress_pct=progress_pct, progress_msg=progress_msg, status="running")
        )
        db.commit()
        self._publish(
            {
                "task_id": self.task_id,
                "status": "running",
                "progress_pct": progress_pct,
                "progress_msg": progress_msg,
            }
        )

    def done(self, db: Session, batch_id: int, device_count: int) -> None:
        db.execute(
            update(UploadTask)
            .where(UploadTask.id == self.task_id)
            .values(
                status="success",
                progress_pct=100,
                progress_msg=f"完成，共入库 {device_count} 行",
                finished_at=datetime.now(UTC),
            )
        )
        db.commit()
        self._publish(
            {
                "task_id": self.task_id,
                "status": "success",
                "progress_pct": 100,
                "progress_msg": f"完成，共入库 {device_count} 行",
                "batch_id": batch_id,
                "device_count": device_count,
                "event": "done",
            }
        )

    def fail(self, db: Session, error_msg: str) -> None:
        db.execute(
            update(UploadTask)
            .where(UploadTask.id == self.task_id)
            .values(
                status="failed",
                error_msg=error_msg,
                finished_at=datetime.now(UTC),
            )
        )
        db.commit()
        self._publish(
            {
                "task_id": self.task_id,
                "status": "failed",
                "error_msg": error_msg,
                "event": "failed",
            }
        )

    def start(self, db: Session, msg: str = "任务开始") -> None:
        db.execute(
            update(UploadTask)
            .where(UploadTask.id == self.task_id)
            .values(status="running", progress_pct=0, progress_msg=msg)
        )
        db.commit()
        self._publish(
            {
                "task_id": self.task_id,
                "status": "running",
                "progress_pct": 0,
                "progress_msg": msg,
                "event": "start",
            }
        )

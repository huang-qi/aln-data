"""任务详情 / 列表响应。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TaskDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_no: str
    status: str
    progress_pct: int
    progress_msg: str | None
    started_at: datetime
    finished_at: datetime | None
    error_msg: str | None


class TaskListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    batch_no: str
    status: str
    progress_pct: int
    started_at: datetime
    finished_at: datetime | None

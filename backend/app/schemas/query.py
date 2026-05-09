"""查询/聚合 请求 + 响应模型。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AggOp = Literal["min", "max", "count", "p25", "p50", "p75", "avg", "sum"]


class MetricSpec(BaseModel):
    field: str
    agg: list[AggOp]


FilterValue = Any


class QueryRequest(BaseModel):
    filters: dict[str, FilterValue] = Field(default_factory=dict)
    fields: list[str] = Field(default_factory=list)
    limit: int = 50000
    order_by: str | None = None


class QueryResponse(BaseModel):
    total: int
    returned: int
    truncated: bool
    rows: list[dict[str, Any]]


class AggregateRequest(BaseModel):
    filters: dict[str, FilterValue] = Field(default_factory=dict)
    group_by: list[str] = Field(default_factory=list)
    metrics: list[MetricSpec] = Field(default_factory=list)


class AggregateResponse(BaseModel):
    groups: list[dict[str, Any]]

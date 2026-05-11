"""查询/聚合 请求 + 响应模型。"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

AggOp = Literal["min", "max", "count", "p25", "p50", "p75", "avg", "sum"]


class MetricSpec(BaseModel):
    field: str
    agg: list[AggOp]


FilterValue = Any

# `filters` 接受两种格式：
#   1. 旧版 dict-of-fields：{field: list | dict-of-ops | scalar}，字段间按 AND。
#   2. 新版 AND/OR 树：{op: "and"|"or", children: [...]}，叶节点 {field, op, value}。
# 解析逻辑见 app.api.query._build_filters。


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

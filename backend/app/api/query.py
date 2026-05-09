"""查询接口：跨批次器件查询 / 聚合 / 字段元数据。"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import ColumnElement, and_, distinct, func, select

from app.api.deps import ALLOWED_QUERY_FIELDS, DEVICE_COLUMNS, DbSession
from app.models import Batch, Device
from app.schemas.query import (
    AggregateRequest,
    AggregateResponse,
    QueryRequest,
    QueryResponse,
)

router = APIRouter(prefix="/query", tags=["query"])

LIMIT_HARD_CAP = 200_000


def _resolve_column(name: str) -> ColumnElement[Any]:
    if name == "batch_no":
        return Batch.batch_no
    if name in DEVICE_COLUMNS:
        return getattr(Device, name)
    raise HTTPException(status_code=400, detail=f"未知字段: {name}")


def _build_filter_clause(name: str, spec: Any) -> ColumnElement[bool]:
    col = _resolve_column(name)
    if isinstance(spec, list):
        if not spec:
            raise HTTPException(status_code=400, detail=f"过滤器 {name} 列表不能为空")
        return col.in_(spec)
    if isinstance(spec, dict):
        clauses: list[ColumnElement[bool]] = []
        for op, val in spec.items():
            if op == "in":
                if not isinstance(val, list) or not val:
                    raise HTTPException(status_code=400, detail=f"{name}.in 必须是非空列表")
                clauses.append(col.in_(val))
            elif op == "eq":
                clauses.append(col == val)
            elif op == "neq":
                clauses.append(col != val)
            elif op == "gte":
                clauses.append(col >= val)
            elif op == "gt":
                clauses.append(col > val)
            elif op == "lte":
                clauses.append(col <= val)
            elif op == "lt":
                clauses.append(col < val)
            elif op == "like":
                clauses.append(col.like(val))
            else:
                raise HTTPException(
                    status_code=400, detail=f"不支持的操作符: {name}.{op}"
                )
        return and_(*clauses)
    return col == spec


def _build_filters(filters: dict[str, Any]) -> list[ColumnElement[bool]]:
    return [_build_filter_clause(k, v) for k, v in filters.items()]


def _aggregate_expr(field: str, op: str) -> ColumnElement[Any]:
    col = _resolve_column(field)
    if op == "count":
        return func.count(col)
    if op == "min":
        return func.min(col)
    if op == "max":
        return func.max(col)
    if op == "avg":
        return func.avg(col)
    if op == "sum":
        return func.sum(col)
    if op in ("p25", "p50", "p75"):
        pct = {"p25": 0.25, "p50": 0.5, "p75": 0.75}[op]
        return func.percentile_cont(pct).within_group(col.asc())
    raise HTTPException(status_code=400, detail=f"不支持的聚合操作: {op}")


def _validate_field_set(fields: list[str]) -> None:
    for f in fields:
        if f not in ALLOWED_QUERY_FIELDS:
            raise HTTPException(status_code=400, detail=f"未知字段: {f}")


@router.post("/devices", response_model=QueryResponse)
def query_devices(req: QueryRequest, db: DbSession) -> QueryResponse:
    if req.limit < 1:
        raise HTTPException(status_code=400, detail="limit 必须 >= 1")
    limit = min(req.limit, LIMIT_HARD_CAP)

    fields = req.fields or [
        "id",
        "batch_no",
        "wafer",
        "coord",
        "x",
        "y",
        "fs_ghz",
        "qs",
        "k2eff_pct",
    ]
    _validate_field_set(fields)
    if req.order_by is not None:
        order_key = req.order_by.lstrip("-+")
        if order_key not in ALLOWED_QUERY_FIELDS:
            raise HTTPException(status_code=400, detail=f"未知排序字段: {order_key}")

    where = _build_filters(req.filters)

    count_stmt = (
        select(func.count())
        .select_from(Device)
        .join(Batch, Device.batch_id == Batch.id)
    )
    if where:
        count_stmt = count_stmt.where(*where)
    total = db.scalar(count_stmt) or 0

    select_cols: list[ColumnElement[Any]] = [_resolve_column(f).label(f) for f in fields]
    stmt = select(*select_cols).join(Batch, Device.batch_id == Batch.id)
    if where:
        stmt = stmt.where(*where)

    if req.order_by is not None:
        order_key = req.order_by.lstrip("-+")
        order_col = _resolve_column(order_key)
        stmt = stmt.order_by(
            order_col.desc() if req.order_by.startswith("-") else order_col.asc()
        )

    stmt = stmt.limit(limit)
    rows = db.execute(stmt).mappings().all()
    rows_out = [dict(r) for r in rows]

    return QueryResponse(
        total=int(total),
        returned=len(rows_out),
        truncated=int(total) > limit,
        rows=rows_out,
    )


@router.post("/aggregate", response_model=AggregateResponse)
def aggregate(req: AggregateRequest, db: DbSession) -> AggregateResponse:
    if not req.metrics:
        raise HTTPException(status_code=400, detail="metrics 不能为空")
    _validate_field_set(req.group_by)
    for m in req.metrics:
        if m.field not in ALLOWED_QUERY_FIELDS:
            raise HTTPException(status_code=400, detail=f"未知字段: {m.field}")

    where = _build_filters(req.filters)

    group_cols = [_resolve_column(g).label(g) for g in req.group_by]
    metric_cols: list[ColumnElement[Any]] = []
    metric_keys: list[tuple[str, str]] = []
    for m in req.metrics:
        for op in m.agg:
            metric_cols.append(_aggregate_expr(m.field, op).label(f"{m.field}__{op}"))
            metric_keys.append((m.field, op))

    select_cols = [*group_cols, *metric_cols]
    stmt = select(*select_cols).join(Batch, Device.batch_id == Batch.id)
    if where:
        stmt = stmt.where(*where)
    if group_cols:
        stmt = stmt.group_by(*[_resolve_column(g) for g in req.group_by])

    rows = db.execute(stmt).mappings().all()
    groups: list[dict[str, Any]] = []
    for r in rows:
        item: dict[str, Any] = {}
        for g in req.group_by:
            item[g] = r[g]
        for field, op in metric_keys:
            item.setdefault(field, {})
            val = r[f"{field}__{op}"]
            item[field][op] = float(val) if val is not None and op != "count" else val
        groups.append(item)

    return AggregateResponse(groups=groups)


@router.get("/distinct")
def distinct_values(
    db: DbSession,
    field: Annotated[str, Query(...)],
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
) -> dict[str, Any]:
    if field == "batch_no":
        stmt = select(distinct(Batch.batch_no)).order_by(Batch.batch_no).limit(limit)
    else:
        col = _resolve_column(field)
        stmt = select(distinct(col)).order_by(col).limit(limit)
    rows = db.execute(stmt).all()
    values = [r[0] for r in rows if r[0] is not None]
    return {"field": field, "values": values}


@router.get("/fields")
def fields_metadata() -> dict[str, Any]:
    return {
        "categorical": [
            {
                "name": "batch_no",
                "label": "批次号",
                "values_endpoint": "/api/query/distinct?field=batch_no",
            },
            {
                "name": "wafer",
                "label": "Wafer",
                "values_endpoint": "/api/query/distinct?field=wafer",
            },
            {"name": "pf", "label": "Pass/Fail", "values": ["Y", "N"]},
            {"name": "folder_name", "label": "端口", "values": ["S11", "S22"]},
        ],
        "geometric": [
            {"name": "x", "label": "X 坐标"},
            {"name": "y", "label": "Y 坐标"},
        ],
        "numeric": [
            {"name": "fs_ghz", "label": "fs", "unit": "GHz"},
            {"name": "fp_ghz", "label": "fp", "unit": "GHz"},
            {"name": "zs_ohm", "label": "Zs", "unit": "Ω"},
            {"name": "zp_ohm", "label": "Zp", "unit": "Ω"},
            {"name": "qs", "label": "Qs", "unit": ""},
            {"name": "qp", "label": "Qp", "unit": ""},
            {"name": "qs_bodeq", "label": "Qs (BodeQ)", "unit": ""},
            {"name": "qp_bodeq", "label": "Qp (BodeQ)", "unit": ""},
            {"name": "dbqs", "label": "dBQs", "unit": "dB"},
            {"name": "dbqp", "label": "dBQp", "unit": "dB"},
            {"name": "bodeq_fitted", "label": "BodeQ Fitted", "unit": ""},
            {"name": "bodeq_smooth", "label": "BodeQ Smooth", "unit": ""},
            {"name": "bodeq_raw", "label": "BodeQ Raw", "unit": ""},
            {"name": "fbode_ghz", "label": "fBode", "unit": "GHz"},
            {"name": "k2eff_pct", "label": "k²eff", "unit": "%"},
            {"name": "fp2_ghz", "label": "fp2", "unit": "GHz"},
            {"name": "fs2_ghz", "label": "fs2", "unit": "GHz"},
            {"name": "zp2_ohm", "label": "Zp2", "unit": "Ω"},
            {"name": "zs2_ohm", "label": "Zs2", "unit": "Ω"},
        ],
        "process": [
            {"name": "eg", "label": "EG"},
            {"name": "fl", "label": "FL"},
            {"name": "ag", "label": "AG"},
        ],
    }

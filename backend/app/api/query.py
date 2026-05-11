"""查询接口：跨批次器件查询 / 聚合 / 字段元数据。"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import ColumnElement, and_, distinct, func, null, or_, select

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
# filter 树深度上限。一个真实 UI 极少超过 ~5 层；32 给手写 JSON 留充足余量，
# 又能挡住恶意嵌套（Python 默认递归上限约 1000）触发 RecursionError → 500。
FILTER_MAX_DEPTH = 32


def _resolve_column(name: str) -> ColumnElement[Any]:
    if name == "batch_no":
        return Batch.batch_no
    if name in DEVICE_COLUMNS:
        return getattr(Device, name)
    raise HTTPException(status_code=400, detail=f"未知字段: {name}")


def _escape_like(val: str) -> str:
    """转义 SQL LIKE 通配符 % 和 _ 与转义符 \\，防止用户输入被解释为通配模式。"""
    return val.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _leaf_clause(field: str, op: str, val: Any) -> ColumnElement[bool]:
    col = _resolve_column(field)
    if op == "in":
        if not isinstance(val, list) or not val:
            raise HTTPException(status_code=400, detail=f"{field}.in 必须是非空列表")
        return col.in_(val)
    if op == "not_in":
        if not isinstance(val, list) or not val:
            raise HTTPException(status_code=400, detail=f"{field}.not_in 必须是非空列表")
        return ~col.in_(val)
    if op == "eq":
        return col == val
    if op == "neq":
        return col != val
    if op == "gte":
        return col >= val
    if op == "gt":
        return col > val
    if op == "lte":
        return col <= val
    if op == "lt":
        return col < val
    if op == "between":
        if not isinstance(val, list) or len(val) != 2:
            raise HTTPException(
                status_code=400, detail=f"{field}.between 必须为长度 2 的列表 [lo, hi]"
            )
        lo, hi = val
        return and_(col >= lo, col <= hi)
    if op == "is_null":
        return col.is_(None)
    if op == "not_null":
        return col.isnot(None)
    if op == "like":
        if not isinstance(val, str):
            raise HTTPException(status_code=400, detail=f"{field}.like 必须为字符串")
        return col.like(_escape_like(val), escape="\\")
    if op == "contains":
        if not isinstance(val, str):
            raise HTTPException(status_code=400, detail=f"{field}.contains 必须为字符串")
        return col.like(f"%{_escape_like(val)}%", escape="\\")
    raise HTTPException(status_code=400, detail=f"不支持的操作符: {field}.{op}")


def _build_filter_clause(name: str, spec: Any) -> ColumnElement[bool]:
    """旧版按字段聚合的格式：
       - list  →  IN
       - dict  →  多操作符 AND
       - 标量  →  等值
    """
    if isinstance(spec, list):
        if not spec:
            raise HTTPException(status_code=400, detail=f"过滤器 {name} 列表不能为空")
        return _leaf_clause(name, "in", spec)
    if isinstance(spec, dict):
        clauses = [_leaf_clause(name, op, val) for op, val in spec.items()]
        return and_(*clauses) if len(clauses) > 1 else clauses[0]
    return _resolve_column(name) == spec


def _build_node(node: dict[str, Any], depth: int = 0) -> ColumnElement[bool]:
    """新版树形格式：
       - 组节点  {"op": "and"|"or", "children": [...]}
       - 叶节点  {"field": str, "op": str, "value": Any}

    depth 上限防止深度嵌套触发 Python RecursionError → 500 DoS。
    """
    if depth > FILTER_MAX_DEPTH:
        raise HTTPException(
            status_code=400,
            detail=f"filter 树嵌套过深（上限 {FILTER_MAX_DEPTH} 层）",
        )
    if not isinstance(node, dict):
        raise HTTPException(status_code=400, detail="filter 节点必须是对象")
    if "field" in node:
        field = node["field"]
        op = node.get("op", "eq")
        val = node.get("value")
        return _leaf_clause(field, op, val)
    if "children" in node:
        op = (node.get("op") or "and").lower()
        children = node["children"]
        if not isinstance(children, list):
            raise HTTPException(status_code=400, detail="children 必须是列表")
        if not children:
            # 空组视作恒真，方便 UI 在用户尚未配置任何条件时也能发请求。
            return null().is_(None)
        clauses = [_build_node(c, depth + 1) for c in children]
        if op == "or":
            return or_(*clauses)
        if op == "and":
            return and_(*clauses)
        raise HTTPException(status_code=400, detail=f"不支持的组合操作符: {op}")
    raise HTTPException(status_code=400, detail="filter 节点必须含 field 或 children")


def _is_tree_filter(filters: Any) -> bool:
    return (
        isinstance(filters, dict)
        and "children" in filters
        and isinstance(filters.get("children"), list)
    )


def _build_filters(filters: Any) -> list[ColumnElement[bool]]:
    if not filters:
        return []
    if _is_tree_filter(filters):
        return [_build_node(filters)]
    if isinstance(filters, dict):
        return [_build_filter_clause(k, v) for k, v in filters.items()]
    raise HTTPException(status_code=400, detail="filters 必须是字典")


def _aggregate_expr(
    field: str, op: str, *, dialect: str | None = None
) -> ColumnElement[Any]:
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
        # percentile_cont 是 PostgreSQL 有序集聚合，SQLite 不支持。
        # SQLite 上回退为 NULL（前端会展示为缺失），避免直接崩溃；
        # 若运行在 SQLite 又必须用 percentile，应换 PostgreSQL 部署。
        if dialect == "sqlite":
            return null()
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

    dialect = db.bind.dialect.name if db.bind is not None else None

    group_cols = [_resolve_column(g).label(g) for g in req.group_by]
    metric_cols: list[ColumnElement[Any]] = []
    metric_keys: list[tuple[str, str]] = []
    for m in req.metrics:
        for op in m.agg:
            metric_cols.append(
                _aggregate_expr(m.field, op, dialect=dialect).label(f"{m.field}__{op}")
            )
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
        stmt = select(distinct(Batch.batch_no)).order_by(Batch.batch_no).limit(limit + 1)
    else:
        col = _resolve_column(field)
        stmt = select(distinct(col)).order_by(col).limit(limit + 1)
    rows = db.execute(stmt).all()
    raw = [r[0] for r in rows]
    has_null = any(v is None for v in raw)
    values = [v for v in raw if v is not None]
    truncated = len(values) > limit or (has_null and len(raw) > limit)
    if truncated:
        values = values[:limit]
    return {
        "field": field,
        "values": values,
        "has_null": has_null,
        "truncated": truncated,
    }


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
            {
                "name": "original_filename",
                "label": "原始文件名",
                "values_endpoint": "/api/query/distinct?field=original_filename",
            },
            {
                "name": "display_name",
                "label": "展示名",
                "values_endpoint": "/api/query/distinct?field=display_name",
            },
            {
                "name": "mark",
                "label": "代号",
                "values_endpoint": "/api/query/distinct?field=mark",
            },
            {
                "name": "coord",
                "label": "坐标",
                "values_endpoint": "/api/query/distinct?field=coord",
            },
            {
                "name": "area_n",
                "label": "Area 编号",
                "values_endpoint": "/api/query/distinct?field=area_n",
            },
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
            {
                "name": "eg",
                "label": "EG",
                "values_endpoint": "/api/query/distinct?field=eg",
            },
            {
                "name": "fl",
                "label": "FL",
                "values_endpoint": "/api/query/distinct?field=fl",
            },
            {
                "name": "ag",
                "label": "AG",
                "values_endpoint": "/api/query/distinct?field=ag",
            },
            {
                "name": "area_um2",
                "label": "Area",
                "unit": "μm²",
                "values_endpoint": "/api/query/distinct?field=area_um2",
            },
        ],
    }

"""FastAPI 入口。

路由分模块挂载：
- /api/uploads        → api/upload.py
- /api/batches        → api/batches.py
- /api/mappings       → api/mappings.py
- /api/query/*        → api/query.py
- /api/devices/*      → api/devices.py
- /api/export/*       → api/export.py
- /api/tasks/*        → api/tasks.py
- /api/health, /api/stats → api/system.py
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

settings = get_settings()
logging.basicConfig(level=settings.LOG_LEVEL)
log = logging.getLogger("aln")

app = FastAPI(
    title="谐振器测试数据平台",
    description="多用户在线上传、入库、可视化分析谐振器测试数据",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS：开发期允许 Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    """健康检查。详见 docs/api.md §9。"""
    # TODO: 实际探测 db / redis / 磁盘
    return {"status": "ok"}


# TODO: 各业务路由模块在 stage 2 实现后挂载
# from app.api import upload, batches, mappings, query, devices, export, tasks, system
# app.include_router(upload.router, prefix="/api")
# app.include_router(batches.router, prefix="/api")
# ...

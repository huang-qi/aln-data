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

from app.api import batches, devices, export, mappings, query, system, tasks, upload
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(batches.router, prefix="/api")
app.include_router(mappings.router, prefix="/api")
app.include_router(query.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(export.router, prefix="/api")

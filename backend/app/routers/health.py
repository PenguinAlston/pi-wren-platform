"""健康检查路由。"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/health")
@router.get("/api/health")
async def health(request: Request):
    return JSONResponse(content={
        "status": "ok",
        "service": "pi-wren-api",
        "version": "0.3.0",
        "time": datetime.now(timezone.utc).isoformat(),
        "backend": "python",
    })

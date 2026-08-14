"""健康检查与指标路由。"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.auth.admin import require_admin
from app.metrics import metrics

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


@router.get("/api/metrics")
async def prometheus_metrics(request: Request):
    """进程指标（Prometheus 文本格式）。

    AUTH_ENABLED 时仅 admin（登录会话或 X-Admin-Token）可见；
    未启用认证时开放（与 API 整体开放程度一致）。
    """
    state = request.app.state.app_state
    if state.settings.AUTH_ENABLED:
        require_admin(request)
    return Response(content=metrics.render(), media_type="text/plain; version=0.0.4")

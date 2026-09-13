"""FastAPI 入口（对应 TS apps/api/src/app.ts + server.ts）。

启动时构建 AppState（WrenEngine + Agent + 连接池），注册路由。
uvicorn app.main:app --port 8080
"""
from __future__ import annotations

import json
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from app.config import get_settings
from app.deps import AppState, build_state
from app.metrics import metrics
from app.routers import (
    admin_agents,
    admin_users,
    agents,
    assistant,
    auth,
    chat,
    graph,
    health,
    internal,
    sessions,
    traditional,
)


def _setup_logging():
    """日志落盘到 backend/logs/（同时保留终端输出），级别由 LOG_LEVEL 控制。"""
    from app.config import get_settings

    level = (get_settings().LOG_LEVEL or "info").upper()
    log_dir = Path(__file__).resolve().parent.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logger.remove()  # 移除默认 stderr，下面重新加
    logger.add(sys.stderr, level=level)
    for filename, encoding in [("app.log", "utf-8"), ("app-gbk.log", "gbk")]:
        logger.add(
            log_dir / filename,
            level=level,
            rotation="10 MB",
            retention="7 days",
            encoding=encoding,
            enqueue=True,
        )
    return log_dir


LOG_DIR = _setup_logging()


# 路由粗分类（避免原始路径里的 id 造成标签爆炸）
def _route_kind(path: str) -> str | None:
    if path.startswith("/internal/agent/"):
        return "internal_ask_data"
    if path.startswith("/internal/traditional/"):
        return "internal_traditional_query"
    if path.startswith("/internal/graph/"):
        return "internal_graph"
    if path.startswith("/api/assistant/"):
        return "assistant_proxy"
    if path.startswith("/api/agent/"):
        return "chat"
    if path.startswith("/api/traditional/"):
        return "traditional_api"
    if path.startswith("/api/graph/"):
        return "graph_api"
    if path.startswith("/api/sessions"):
        return "sessions_api"
    if path.startswith("/api/auth/"):
        return "auth_api"
    if path.startswith("/api/admin/"):
        return "admin_api"
    if path.startswith("/api/feedback"):
        return "feedback_api"
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时构建依赖，关闭时释放资源。"""
    settings = get_settings()
    logger.info("启动 pi-wren Python 后端 (port={})", settings.PORT)

    # 错误追踪（可选）：配置 SENTRY_DSN 即启用，未配置零开销
    if settings.SENTRY_DSN:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.NODE_ENV,
            traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        )
        logger.info("Sentry 错误追踪已启用")

    state = await build_state(settings)
    app.state.app_state = state

    yield

    # 清理
    logger.info("正在关闭...")
    if state.redis is not None:
        try:
            await state.redis.aclose()
        except Exception:
            pass
    try:
        state.engine.close()
    except Exception:
        pass
    if state.pool:
        await state.pool.close()
    logger.info("已关闭")


def create_app() -> FastAPI:
    app = FastAPI(title="pi-wren-api", version="0.3.0", lifespan=lifespan)

    from app.auth.middleware import AuthMiddleware

    # 认证中间件：AUTH_ENABLED 时守护 /api/*（登录/健康检查除外）；延迟取 app_state 避开启动顺序
    app.add_middleware(
        AuthMiddleware,
        settings=get_settings(),
        get_state=lambda: app.state.app_state,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[get_settings().CORS_ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # HTTP 指标（Prometheus）：请求数 + 时延直方图，按粗分类路由打标签
    @app.middleware("http")
    async def prom_http_metrics(request: Request, call_next):
        kind = _route_kind(request.url.path)
        if kind is None:
            return await call_next(request)
        started = time.monotonic()
        try:
            response = await call_next(request)
            status = str(response.status_code)
        except Exception:
            metrics.inc_counter("http_requests", kind=kind, method=request.method, status="500")
            raise
        finally:
            metrics.observe("http_duration", (time.monotonic() - started) * 1000, kind=kind)
        metrics.inc_counter("http_requests", kind=kind, method=request.method, status=status)
        return response

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(agents.router)
    app.include_router(chat.router)
    app.include_router(sessions.router)
    app.include_router(admin_agents.router)
    app.include_router(admin_users.router)
    app.include_router(traditional.router)
    app.include_router(graph.router)
    app.include_router(internal.router)
    app.include_router(assistant.router)

    @app.get("/")
    async def root():
        return {"service": "pi-wren-api", "backend": "python"}

    # 非法请求体（编码错误/坏 JSON）按客户端错误返回 400，而不是冒充服务器 500
    @app.exception_handler(json.JSONDecodeError)
    @app.exception_handler(UnicodeDecodeError)
    async def malformed_json_body(request, exc):
        return JSONResponse(
            status_code=400,
            content={"error": "invalid JSON body（需 UTF-8 编码的合法 JSON）"},
        )

    # admin 鉴权失败：保持既有响应契约 {"error": "unauthorized"}
    from app.auth.admin import AdminUnauthorized

    @app.exception_handler(AdminUnauthorized)
    async def admin_unauthorized(request, exc):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})

    return app


app = create_app()

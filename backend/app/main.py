"""FastAPI 入口（对应 TS apps/api/src/app.ts + server.ts）。

启动时构建 AppState（WrenEngine + Agent + 连接池），注册路由。
uvicorn app.main:app --port 8080
"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.config import get_settings
from app.deps import AppState, build_state
from app.routers import admin_agents, agents, chat, health, sessions, traditional


def _setup_logging():
    """日志落盘到 backend/logs/（同时保留终端输出）。

    app.log     —— UTF-8（Linux/通用）
    app-gbk.log —— GBK（Windows 记事本/type 直接可读，不乱码）
    """
    log_dir = Path(__file__).resolve().parent.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    logger.remove()  # 移除默认 stderr，下面重新加
    logger.add(sys.stderr, level="INFO")
    for filename, encoding in [("app.log", "utf-8"), ("app-gbk.log", "gbk")]:
        logger.add(
            log_dir / filename,
            level="INFO",
            rotation="10 MB",
            retention="7 days",
            encoding=encoding,
            enqueue=True,
        )
    return log_dir


LOG_DIR = _setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时构建依赖，关闭时释放资源。"""
    settings = get_settings()
    logger.info("启动 pi-wren Python 后端 (port={})", settings.PORT)

    state = await build_state(settings)
    app.state.app_state = state

    yield

    # 清理
    logger.info("正在关闭...")
    try:
        state.engine.close()
    except Exception:
        pass
    if state.pool:
        await state.pool.close()
    logger.info("已关闭")


def create_app() -> FastAPI:
    app = FastAPI(title="pi-wren-api", version="0.3.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[get_settings().CORS_ORIGIN],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(agents.router)
    app.include_router(chat.router)
    app.include_router(sessions.router)
    app.include_router(admin_agents.router)
    app.include_router(traditional.router)

    @app.get("/")
    async def root():
        return {"service": "pi-wren-api", "backend": "python"}

    return app


app = create_app()

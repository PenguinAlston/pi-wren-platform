"""admin 鉴权公共依赖：登录会话 role=admin 或 X-Admin-Token，三处管理路由统一使用。"""
from __future__ import annotations

from fastapi import HTTPException, Request


class AdminUnauthorized(HTTPException):
    """保持既有响应契约：401 + {"error": "unauthorized"}（经 main.py 注册的 handler 渲染）。"""

    def __init__(self):
        super().__init__(status_code=401)


def require_admin(request: Request) -> None:
    """FastAPI 依赖用法：`endpoint(request: Request, _: None = Depends(require_admin))`。"""
    user = getattr(request.state, "user", None)
    if user is not None and user.role == "admin":
        return
    token = request.app.state.app_state.settings.ADMIN_TOKEN
    if token and request.headers.get("x-admin-token") == token:
        return
    raise AdminUnauthorized()

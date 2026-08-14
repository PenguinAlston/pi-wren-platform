"""认证中间件：AUTH_ENABLED 时守护全部 /api/*（登录/健康检查除外）。

- 校验会话 Cookie（HMAC 签名 + 有效期 + 用户状态 active）
- 解析出的用户写入 scope["state"]["user"]，路由经 request.state.user 读取
- 未启用认证时零开销直通（仍会尝试解析，供 /api/auth/me 探测）
"""
from __future__ import annotations

import json

from app.auth.tokens import verify_token

# 无需登录即可访问的路径前缀
_EXEMPT_PREFIXES = ("/api/auth/", "/api/health", "/health", "/docs", "/openapi.json")


class AuthMiddleware:
    def __init__(self, app, settings, get_state):
        """get_state: () -> AppState（延迟取，避开 lifespan 前后顺序问题）。"""
        self.app = app
        self._settings = settings
        self._get_state = get_state

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        state = self._get_state()
        user = await self._resolve_user(scope, state)
        scope.setdefault("state", {})
        if user is not None:
            scope["state"]["user"] = user

        if state.settings.AUTH_ENABLED and not _is_exempt(path) and user is None:
            response = _json_response(401, {"error": "unauthorized", "authRequired": True})
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)

    async def _resolve_user(self, scope, state):
        users = getattr(state, "users", None)
        if users is None:
            return None
        token = _cookie_from_scope(scope, state.settings.AUTH_COOKIE_NAME)
        if not token:
            return None
        payload = verify_token(state.settings.AUTH_SECRET or "", token)
        if not payload:
            return None
        user = await users.find_by_user_id(payload["uid"])
        if user is None or user.status != "active":
            return None
        return user


def _is_exempt(path: str) -> bool:
    return any(path == p or path.startswith(p) for p in _EXEMPT_PREFIXES)


def _cookie_from_scope(scope, name: str) -> str | None:
    for key, value in scope.get("headers", []):
        if key == b"cookie":
            try:
                cookie_header = value.decode("latin-1")
            except UnicodeDecodeError:
                return None
            for part in cookie_header.split(";"):
                k, _, v = part.strip().partition("=")
                if k == name:
                    return v
    return None


def _json_response(status: int, content: dict):
    from starlette.responses import Response

    return Response(
        content=json.dumps(content, ensure_ascii=False),
        status_code=status,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )

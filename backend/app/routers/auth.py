"""认证路由：登录 / 登出 / 当前用户。

登录成功签发 HMAC 会话 Cookie（HttpOnly + SameSite=Lax；
生产环境 NODE_ENV=production 时加 Secure）。
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from loguru import logger

from app.auth.passwords import verify_password
from app.auth.tokens import sign_token

router = APIRouter()

_MAX_USERNAME_LEN = 64
_MAX_PASSWORD_LEN = 1024


def _user_payload(user) -> dict:
    return {"userId": user.user_id, "username": user.username,
            "displayName": user.display_name, "role": user.role}


def _set_cookie(response: JSONResponse, settings, token: str) -> JSONResponse:
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=token,
        max_age=settings.AUTH_SESSION_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.NODE_ENV == "production",
        path="/",
    )
    return response


@router.post("/api/auth/login")
async def login(request: Request):
    state = request.app.state.app_state
    settings = state.settings
    if not settings.AUTH_ENABLED:
        return JSONResponse(status_code=400, content={"error": "auth is disabled"})

    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or len(username) > _MAX_USERNAME_LEN or len(password) > _MAX_PASSWORD_LEN:
        return JSONResponse(status_code=400, content={"error": "invalid credentials"})

    # 按 IP 限流（防暴力破解；认证场景 IP 是唯一稳定键）
    limiter = state.rate_limit_login
    ip = request.client.host if request.client else "unknown"
    if limiter is not None and limiter.limit > 0 and not limiter.allow(f"ip:{ip}"):
        retry = limiter.retry_after(f"ip:{ip}")
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry)},
            content={"error": f"尝试过于频繁，请 {retry} 秒后重试"},
        )

    user = await state.users.find_by_username(username)
    stored_hash = await state.users.get_password_hash(user.user_id) if user else ""
    if not user or user.status != "active" or not verify_password(password, stored_hash):
        logger.info("登录失败: username={}", username)
        return JSONResponse(status_code=401, content={"error": "invalid username or password"})

    token = sign_token(settings.AUTH_SECRET or "", user.user_id, user.role,
                       settings.AUTH_SESSION_HOURS * 3600)
    logger.info("登录成功: username={} role={}", username, user.role)
    if state.audit:
        await state.audit.log("LOGIN", f"用户登录: {username}", user_id=user.user_id,
                              ip_address=request.client.host if request.client else None)
    return _set_cookie(JSONResponse(content={"user": _user_payload(user)}), settings, token)


@router.post("/api/auth/logout")
async def logout(request: Request):
    state = request.app.state.app_state
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key=state.settings.AUTH_COOKIE_NAME, path="/")
    return response


@router.get("/api/auth/me")
async def me(request: Request):
    state = request.app.state.app_state
    user = getattr(request.state, "user", None)
    if not state.settings.AUTH_ENABLED:
        return JSONResponse(content={"enabled": False, "user": None})
    if user is None:
        return JSONResponse(status_code=401,
                            content={"enabled": True, "user": None, "authRequired": True})
    return JSONResponse(content={"enabled": True, "user": _user_payload(user)})

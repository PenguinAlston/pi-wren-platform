"""用户管理路由（仅 admin：登录会话 role=admin 或 X-Admin-Token）。

列表 / 创建 / 改角色 / 启停 / 重置口令；全部操作写审计。
保护约束：不能停用/降级自己（防止锁死最后一个管理员）。
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from loguru import logger

from app.auth.admin import require_admin
from app.auth.passwords import hash_password

router = APIRouter()

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{2,64}$")
_MIN_PASSWORD_LEN = 8


def _users_or_disabled(request: Request) -> JSONResponse | None:
    """AUTH_ENABLED=false 时 UserStore 未构建：返回明确错误而非 500。"""
    if request.app.state.app_state.users is None:
        return JSONResponse(status_code=400, content={"error": "用户认证未启用（.env 配置 AUTH_ENABLED=true 并重启后端）"})
    return None


def _public(user) -> dict:
    return {"userId": user.user_id, "username": user.username,
            "displayName": user.display_name, "role": user.role, "status": user.status}


@router.get("/api/admin/users")
async def list_users(request: Request):
    require_admin(request)
    disabled = _users_or_disabled(request)
    if disabled:
        return disabled
    users = await request.app.state.app_state.users.list_users()
    return JSONResponse(content={"users": [_public(u) for u in users]})


@router.post("/api/admin/users")
async def create_user(request: Request):
    state = request.app.state.app_state
    require_admin(request)
    disabled = _users_or_disabled(request)
    if disabled:
        return disabled
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    role = body.get("role") or "user"
    display_name = (body.get("displayName") or "").strip() or None

    if not _USERNAME_RE.match(username):
        return JSONResponse(status_code=400, content={"error": "username 需为 2-64 位字母/数字/_.-"})
    if len(password) > 1024 or len(password) < _MIN_PASSWORD_LEN:
        return JSONResponse(status_code=400, content={"error": f"password 至少 {_MIN_PASSWORD_LEN} 位"})
    if role not in ("admin", "user"):
        return JSONResponse(status_code=400, content={"error": "role 仅支持 admin | user"})

    if await state.users.find_by_username(username):
        return JSONResponse(status_code=409, content={"error": f"username 已存在: {username}"})
    user = await state.users.create_user(username, password, role=role, display_name=display_name)
    actor = getattr(request.state, "user", None)
    logger.info("创建用户: {} role={} by {}", username, role, actor.username if actor else "token")
    if state.audit:
        await state.audit.log("USER_CREATE", f"创建用户 {username}（role={role}）",
                              user_id=actor.user_id if actor else None,
                              ip_address=request.client.host if request.client else None)
    return JSONResponse(content={"user": _public(user)}, status_code=201)


@router.put("/api/admin/users/{user_id}")
async def update_user(user_id: str, request: Request):
    state = request.app.state.app_state
    require_admin(request)
    disabled = _users_or_disabled(request)
    if disabled:
        return disabled
    target = await state.users.find_by_user_id_uncached(user_id)
    if not target:
        return JSONResponse(status_code=404, content={"error": "user not found"})

    body = await request.json()
    role = body.get("role")
    status = body.get("status")
    display_name = (body.get("displayName") or "").strip() or None
    if role is not None and role not in ("admin", "user"):
        return JSONResponse(status_code=400, content={"error": "role 仅支持 admin | user"})
    if status is not None and status not in ("active", "disabled"):
        return JSONResponse(status_code=400, content={"error": "status 仅支持 active | disabled"})

    actor = getattr(request.state, "user", None)
    is_self = actor is not None and actor.user_id == user_id
    # 自我保护：不能停用自己 / 不能把自己降级（防止锁死最后一个管理员）
    if is_self and status == "disabled":
        return JSONResponse(status_code=400, content={"error": "不能停用自己的账号"})
    if is_self and role == "user":
        return JSONResponse(status_code=400, content={"error": "不能降级自己的账号"})
    # 降级/停用他人时，保证系统至少剩一个活跃 admin
    demotes_admin = target.role == "admin" and (role == "user" or status == "disabled")
    if demotes_admin and await state.users.count_active_admins() <= 1:
        return JSONResponse(status_code=400, content={"error": "系统至少需要保留一个活跃的 admin"})

    await state.users.update_user(user_id, role=role, status=status, display_name=display_name)
    updated = await state.users.find_by_user_id_uncached(user_id)
    logger.info("更新用户: {} role={} status={} by {}", user_id, role, status,
                actor.username if actor else "token")
    if state.audit:
        await state.audit.log("USER_UPDATE", f"更新用户 {target.username}（role={role}, status={status}）",
                              user_id=actor.user_id if actor else None,
                              ip_address=request.client.host if request.client else None)
    return JSONResponse(content={"user": _public(updated)})


@router.put("/api/admin/users/{user_id}/password")
async def reset_password(user_id: str, request: Request):
    state = request.app.state.app_state
    require_admin(request)
    disabled = _users_or_disabled(request)
    if disabled:
        return disabled
    target = await state.users.find_by_user_id_uncached(user_id)
    if not target:
        return JSONResponse(status_code=404, content={"error": "user not found"})
    body = await request.json()
    password = body.get("password") or ""
    if len(password) < _MIN_PASSWORD_LEN or len(password) > 1024:
        return JSONResponse(status_code=400, content={"error": f"password 至少 {_MIN_PASSWORD_LEN} 位"})

    await state.users.set_password(user_id, password)
    actor = getattr(request.state, "user", None)
    logger.info("重置口令: {} by {}", target.username, actor.username if actor else "token")
    if state.audit:
        await state.audit.log("USER_RESET_PASSWORD", f"重置用户 {target.username} 的口令",
                              user_id=actor.user_id if actor else None,
                              ip_address=request.client.host if request.client else None)
    return JSONResponse(content={"ok": True})

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
_ORG_UNSET = object()  # update 请求未携带 orgId 键（区分"取消分配"）


def _users_or_disabled(request: Request) -> JSONResponse | None:
    """AUTH_ENABLED=false 时 UserStore 未构建：返回明确错误而非 500。"""
    if request.app.state.app_state.users is None:
        return JSONResponse(status_code=400, content={"error": "用户认证未启用（.env 配置 AUTH_ENABLED=true 并重启后端）"})
    return None


def _public(user) -> dict:
    return {"userId": user.user_id, "username": user.username,
            "displayName": user.display_name, "role": user.role, "status": user.status,
            "orgId": user.org_id}


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
    org_id = (body.get("orgId") or "").strip() or None

    if not _USERNAME_RE.match(username):
        return JSONResponse(status_code=400, content={"error": "username 需为 2-64 位字母/数字/_.-"})
    if len(password) > 1024 or len(password) < _MIN_PASSWORD_LEN:
        return JSONResponse(status_code=400, content={"error": f"password 至少 {_MIN_PASSWORD_LEN} 位"})
    if role not in ("admin", "user"):
        return JSONResponse(status_code=400, content={"error": "role 仅支持 admin | user"})
    if org_id and not await state.users.org_exists(org_id):
        return JSONResponse(status_code=400, content={"error": f"机构不存在: {org_id}"})

    if await state.users.find_by_username(username):
        return JSONResponse(status_code=409, content={"error": f"username 已存在: {username}"})
    user = await state.users.create_user(username, password, role=role, display_name=display_name,
                                         org_id=org_id)
    actor = getattr(request.state, "user", None)
    logger.info("创建用户: {} role={} org={} by {}", username, role, org_id or "-",
                actor.username if actor else "token")
    if state.audit:
        await state.audit.log("USER_CREATE", f"创建用户 {username}（role={role}, org={org_id or '未分配'}）",
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
    # orgId 键出现即视为一次机构分配（空串/None = 取消分配）
    org_update: str | None | object = _ORG_UNSET
    if "orgId" in body:
        org_update = (body.get("orgId") or "").strip() or None
        if isinstance(org_update, str) and not await state.users.org_exists(org_update):
            return JSONResponse(status_code=400, content={"error": f"机构不存在: {org_update}"})

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
    if org_update is not _ORG_UNSET:
        await state.users.set_org(user_id, org_update)  # type: ignore[arg-type]
    updated = await state.users.find_by_user_id_uncached(user_id)
    logger.info("更新用户: {} role={} status={} by {}", user_id, role, status,
                actor.username if actor else "token")
    if state.audit:
        org_note = "" if org_update is _ORG_UNSET else f", org={org_update or '取消分配'}"
        await state.audit.log("USER_UPDATE", f"更新用户 {target.username}（role={role}, status={status}{org_note}）",
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

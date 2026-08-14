"""会话管理路由（对应 TS routes/sessions.ts）：列表/回看/重命名/删除。

认证启用时按用户归属隔离（本人仅见自己的会话；admin 可见全部，含认证前的历史会话）。
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.session.db_store import can_access_session

router = APIRouter()

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _store(request: Request):
    return request.app.state.app_state.memory


def _viewer(request: Request):
    """返回 (user_id, is_admin)。未启用认证时 (None, False) = 沿用旧行为（全部可见）。"""
    user = getattr(request.state, "user", None)
    if user is None:
        return None, False
    return user.user_id, user.role == "admin"


async def _check_owner(request: Request, session_id: str) -> JSONResponse | None:
    """归属校验：无权限时返回 403/404 响应；有权限返回 None。未启用认证直接放行。"""
    user_id, is_admin = _viewer(request)
    if user_id is None:
        return None
    owner = await _store(request).get_session_owner(session_id)
    if owner is None:
        # 不存在 → 404；认证前的历史会话（owner=NULL）→ 仅 admin 可访问
        exists = await _store(request).get_session(session_id) is not None
        if not exists:
            return JSONResponse(status_code=404, content={"error": "session not found"})
        if not is_admin:
            return JSONResponse(status_code=403, content={"error": "forbidden"})
        return None
    if not can_access_session(owner, user_id, is_admin):
        return JSONResponse(status_code=403, content={"error": "forbidden"})
    return None


@router.get("/api/sessions")
async def list_sessions(request: Request):
    # ?agentId= 按 Agent 隔离会话列表；user 维度按登录身份过滤（admin 不过滤）。
    agent_id = request.query_params.get("agentId") or None
    user_id, is_admin = _viewer(request)
    filter_user = user_id if (user_id is not None and not is_admin) else None
    sessions = await _store(request).list_sessions(agent_id=agent_id, user_id=filter_user)
    return JSONResponse(content={"sessions": sessions})


@router.get("/api/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    forbidden = await _check_owner(request, session_id)
    if forbidden:
        return forbidden
    session = await _store(request).get_session(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "session not found"})
    return JSONResponse(content={"sessionId": session_id, "name": session["name"], "messages": session["records"]})


@router.put("/api/sessions/{session_id}")
async def rename_session(session_id: str, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    forbidden = await _check_owner(request, session_id)
    if forbidden:
        return forbidden
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "invalid request", "details": {"name": "required"}})
    try:
        await _store(request).rename(session_id, name)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"error": "rename failed: session not found"})
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    return JSONResponse(content={"sessionId": session_id, "name": name})


@router.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    forbidden = await _check_owner(request, session_id)
    if forbidden:
        return forbidden
    ok = await _store(request).delete(session_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": "session not found"})
    return JSONResponse(status_code=204, content=None)

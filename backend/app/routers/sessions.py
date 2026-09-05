"""会话管理路由（对应 TS routes/sessions.ts）：列表/回看/重命名/删除 + 回答反馈。

认证启用时按用户归属隔离（本人仅见自己的会话；admin 可见全部，含认证前的历史会话）。
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.admin import require_admin
from app.metrics import metrics
from app.session.db_store import can_access_session

router = APIRouter()

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _store(request: Request):
    return request.app.state.app_state.memory


def _feedback_store(request: Request):
    return request.app.state.app_state.feedback


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


# --- 回答反馈（效果闭环：点赞/点踩落库，同值再点取消）---


async def _check_message_in_session(request: Request, session_id: str, message_id: int):
    """消息必须存在于目标会话（不存在或属他会话一律 404，不泄露存在性）。"""
    owner_session = await _feedback_store(request).message_session(message_id)
    if owner_session != session_id:
        return JSONResponse(status_code=404, content={"error": "message not found in session"})
    return None


@router.put("/api/sessions/{session_id}/messages/{message_id}/feedback")
async def set_message_feedback(session_id: str, message_id: int, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    forbidden = await _check_owner(request, session_id)
    if forbidden:
        return forbidden
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
    rating = body.get("rating")
    if rating not in (1, -1):
        return JSONResponse(status_code=400, content={"error": "invalid request",
                                                      "details": {"rating": "must be 1 or -1"}})
    comment = body.get("comment")
    if comment is not None:
        comment = str(comment).strip()[:1000] or None
    not_found = await _check_message_in_session(request, session_id, message_id)
    if not_found:
        return not_found
    user_id, _ = _viewer(request)
    await _feedback_store(request).set_feedback(session_id, message_id, rating, user_id, comment)
    metrics.inc_counter("feedback", rating="up" if rating == 1 else "down")
    return JSONResponse(content={"messageId": message_id, "rating": rating})


@router.delete("/api/sessions/{session_id}/messages/{message_id}/feedback")
async def clear_message_feedback(session_id: str, message_id: int, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    forbidden = await _check_owner(request, session_id)
    if forbidden:
        return forbidden
    not_found = await _check_message_in_session(request, session_id, message_id)
    if not_found:
        return not_found
    ok = await _feedback_store(request).clear_feedback(message_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": "feedback not found"})
    return JSONResponse(status_code=204, content=None)


@router.get("/api/admin/feedback")
async def list_feedback(request: Request, _: None = Depends(require_admin)):
    """反馈复盘清单（admin）：可按 rating 过滤，用于点踩案例回看与评测集沉淀。"""
    rating = None
    rating_param = request.query_params.get("rating")
    if rating_param is not None:
        try:
            rating = int(rating_param)
        except ValueError:
            return JSONResponse(status_code=400, content={"error": "invalid rating"})
        if rating not in (1, -1):
            return JSONResponse(status_code=400, content={"error": "invalid rating"})
    limit = 50
    limit_param = request.query_params.get("limit")
    if limit_param:
        try:
            limit = max(1, min(int(limit_param), 200))
        except ValueError:
            return JSONResponse(status_code=400, content={"error": "invalid limit"})
    items = await _feedback_store(request).list_feedback(rating=rating, limit=limit)
    return JSONResponse(content={"feedback": items})

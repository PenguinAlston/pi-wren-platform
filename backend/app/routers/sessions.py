"""会话管理路由（对应 TS routes/sessions.ts）：列表/回看/重命名/删除。"""
from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _store(request: Request):
    return request.app.state.app_state.memory


@router.get("/api/sessions")
async def list_sessions(request: Request):
    sessions = await _store(request).list_sessions()
    return JSONResponse(content={"sessions": sessions})


@router.get("/api/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    session = await _store(request).get_session(session_id)
    if not session:
        return JSONResponse(status_code=404, content={"error": "session not found"})
    return JSONResponse(content={"sessionId": session_id, "name": session["name"], "messages": session["records"]})


@router.put("/api/sessions/{session_id}")
async def rename_session(session_id: str, request: Request):
    if not _SESSION_ID_RE.match(session_id):
        return JSONResponse(status_code=400, content={"error": "invalid sessionId"})
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
    ok = await _store(request).delete(session_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": "session not found"})
    return JSONResponse(status_code=204, content=None)

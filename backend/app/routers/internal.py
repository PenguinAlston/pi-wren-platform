"""内部接口：供 Pi orchestrator 调用（internal token 鉴权，非公网）。

权限不从请求头取——按 x-user-id 反查本地用户表构造 OrgAccess，头部只传身份不传权限。
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth.org_access import OrgAccess
from app.deps import AppState

router = APIRouter(prefix="/internal")


def _check_internal_token(request: Request, settings) -> JSONResponse | None:
    """internal token 常量时间比较；未配置 = 拒绝一切（fail-closed）。"""
    expected = settings.INTERNAL_API_TOKEN or ""
    provided = request.headers.get("x-internal-token", "")
    if not expected or not provided or not secrets.compare_digest(provided, expected):
        return JSONResponse(status_code=401, content={"error": "invalid internal token"})
    return None


async def _resolve_access(request: Request, state: AppState) -> tuple[OrgAccess | None, str | None, JSONResponse | None]:
    """身份反查：AUTH_ENABLED 时按 user_id 查用户（存储自带缓存）构造三态权限。"""
    user_id = request.headers.get("x-user-id")
    if not state.settings.AUTH_ENABLED:
        return OrgAccess.unrestricted(), user_id, None
    user = await state.users.find_by_user_id(user_id) if (user_id and state.users) else None
    if user is None or user.status != "active":
        return None, user_id, JSONResponse(status_code=401, content={"error": "unknown or inactive user"})
    return OrgAccess.for_user(user), user_id, None


@router.post("/agent/{domain}/chat")
async def internal_agent_chat(domain: str, request: Request):
    state: AppState = request.app.state.app_state
    token_error = _check_internal_token(request, state.settings)
    if token_error:
        return token_error

    access, user_id, access_error = await _resolve_access(request, state)
    if access_error:
        return access_error

    spec = state.get_agent(domain)
    if not spec:
        return JSONResponse(status_code=404, content={"error": f"unknown agent: {domain}"})

    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message or len(message) > 4000:
        return JSONResponse(status_code=400, content={"error": "message is required (1-4000 chars)"})
    session_id = body.get("sessionId") or None

    # persist=False：会话历史由 Pi 侧 JSONL 负责，不写入经典问数会话列表
    result = await spec.agent.answer(
        message, session_id=session_id, user_id=user_id, org_access=access, persist=False,
    )
    return JSONResponse(content=result.model_dump())

"""聊天路由（对应 TS routes/chat.ts + chat-stream.ts）。

POST /api/agent/chat                 — 默认 Agent JSON 问答
POST /api/agent/:domain/chat         — 按领域 JSON 问答
POST /api/agent/:domain/chat/stream  — SSE 流式问答（执行事件实时推送）
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from loguru import logger
from sse_starlette.sse import EventSourceResponse

from app.deps import AppState
from app.models.schemas import ChatRequest

router = APIRouter()

# sessionId 白名单：仅字母/数字/下划线/连字符，杜绝路径穿越
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _get_agent(state: AppState, domain: str):
    spec = state.get_agent(domain)
    if not spec:
        return None, JSONResponse(status_code=404, content={"error": f"unknown agent: {domain}"})
    return spec, None


def _validate_request(body: dict) -> tuple[ChatRequest | None, JSONResponse | None]:
    message = (body.get("message") or "").strip()
    if not message or len(message) > 4000:
        return None, JSONResponse(status_code=400, content={"error": "message is required (1-4000 chars)"})
    session_id = body.get("sessionId")
    if session_id and not _SESSION_ID_RE.match(session_id):
        return None, JSONResponse(status_code=400, content={"error": "invalid sessionId"})
    return ChatRequest(message=message, sessionId=session_id), None


def _ascii_json(obj) -> str:
    """JSON 序列化转义非 ASCII（与 TS 版 sse.ts 一致，防代理层编码损坏中文）。"""
    return json.dumps(obj, ensure_ascii=True, default=str)


@router.post("/api/agent/chat")
async def chat_default(request: Request):
    """默认 Agent 问答（兼容旧前端）。"""
    state: AppState = request.app.state.app_state
    # 默认取第一个内置 Agent
    domain = next(iter(state.agents.keys()), "insurance")
    return await _chat(state, domain, await request.json())


@router.post("/api/agent/{domain}/chat")
async def chat_json(domain: str, request: Request):
    """按领域 JSON 问答。"""
    state: AppState = request.app.state.app_state
    return await _chat(state, domain, await request.json())


async def _chat(state: AppState, domain: str, body: dict) -> JSONResponse:
    spec, err = _get_agent(state, domain)
    if err:
        return err
    req, err = _validate_request(body)
    if err:
        return err

    logger.info("chat: domain={} session={}", domain, req.sessionId)
    result = await spec.agent.answer(req.message, session_id=req.sessionId)
    return JSONResponse(content=result.model_dump())


@router.post("/api/agent/{domain}/chat/stream")
async def chat_stream(domain: str, request: Request):
    """SSE 流式问答：执行事件逐帧推送，结束帧 done 携带完整结果。"""
    state: AppState = request.app.state.app_state
    spec, err = _get_agent(state, domain)
    if err:
        return err
    body = await request.json()
    req, err = _validate_request(body)
    if err:
        return err

    logger.info("chat stream: domain={} session={}", domain, req.sessionId)

    async def event_generator():
        def on_event(event):
            payload = {
                "id": event.id,
                "type": event.type,
                "label": event.label,
                "timestamp": event.timestamp,
            }
            if event.detail is not None:
                payload["detail"] = event.detail
            # SSE 格式：event: <type>\ndata: <ascii-json>\n\n（与 TS sse.ts 对齐）
            yield {
                "event": event.type,
                "data": _ascii_json(payload),
            }

        result = await spec.agent.answer(
            req.message,
            session_id=req.sessionId,
            on_event=lambda e: None,  # 事件通过下方收集后推送
        )

        # 先推送执行事件
        for event in result.events:
            payload = {
                "id": event.id,
                "type": event.type,
                "label": event.label,
                "timestamp": event.timestamp,
            }
            if event.detail is not None:
                payload["detail"] = event.detail
            yield {"event": event.type, "data": _ascii_json(payload)}

        # 结束帧
        yield {"event": "done", "data": _ascii_json(result.model_dump())}

    # sep="\n"：sse-starlette 默认 \r\n 行尾，前端 parseSseFrames 用 split('\n\n') 切帧，
    # \r\n\r\n 中不含字面 \n\n 导致无法切帧 → 改用 \n 与 TS 版 SSE 格式（\n\n）完全一致
    # Cache-Control: no-transform：阻止 Next.js 代理对 SSE 流做 gzip 压缩（压缩会缓冲整个流，
    # 导致浏览器流式读取拿不到增量数据，页面一直 loading 无显示）
    return EventSourceResponse(
        event_generator(),
        sep="\n",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

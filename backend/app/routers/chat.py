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
from app.metrics import metrics
from app.models.schemas import ChatRequest

router = APIRouter()

# sessionId 白名单：仅字母/数字/下划线/连字符，杜绝路径穿越
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _rate_limit_key(request: Request, user_id: str | None) -> str:
    """限流键：优先用户，未认证回落到客户端 IP。"""
    if user_id:
        return f"user:{user_id}"
    client = request.client.host if request.client else "unknown"
    return f"ip:{client}"


def _check_chat_rate_limit(state: AppState, request: Request, user_id: str | None) -> JSONResponse | None:
    """聊天限流（LLM 成本防护）。超限返回 429，未超限返回 None。"""
    limiter = state.rate_limit_chat
    if limiter is None or limiter.limit == 0:
        return None
    key = _rate_limit_key(request, user_id)
    if limiter.allow(key):
        return None
    retry = limiter.retry_after(key)
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(retry)},
        content={"error": f"请求过于频繁，请 {retry} 秒后重试"},
    )


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
    return await _chat(state, domain, await request.json(), request)


@router.post("/api/agent/{domain}/chat")
async def chat_json(domain: str, request: Request):
    """按领域 JSON 问答。"""
    state: AppState = request.app.state.app_state
    return await _chat(state, domain, await request.json(), request)


async def _chat(state: AppState, domain: str, body: dict, request: Request) -> JSONResponse:
    spec, err = _get_agent(state, domain)
    if err:
        return err
    req, err = _validate_request(body)
    if err:
        return err
    user = getattr(request.state, "user", None)
    user_id = user.user_id if user else None

    limited = _check_chat_rate_limit(state, request, user_id)
    if limited:
        return limited

    logger.info("chat: domain={} session={} user={}", domain, req.sessionId, user_id or "-")
    import time as _time

    started = _time.monotonic()
    result = await spec.agent.answer(req.message, session_id=req.sessionId, user_id=user_id)
    metrics.observe("chat_duration", (_time.monotonic() - started) * 1000)
    metrics.inc_counter("chat", agent=domain, status="error" if result.error else "ok")
    await _audit_chat(state, user_id, request, req.message, result)
    return JSONResponse(content=result.model_dump())


async def _audit_chat(state: AppState, user_id: str | None, request: Request,
                      question: str, result) -> None:
    """AI 问答审计：谁问了什么、生成了什么 SQL（失败不阻断，内容截断防超大日志）。"""
    if not state.audit:
        return
    await state.audit.log(
        "AI_CHAT",
        question[:1000],
        sql_content=(result.sql or "")[:4000] if result.sql else None,
        ip_address=request.client.host if request.client else None,
        user_id=user_id or "ANONYMOUS",
    )


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
    user = getattr(request.state, "user", None)
    user_id = user.user_id if user else None

    limited = _check_chat_rate_limit(state, request, user_id)
    if limited:
        return limited

    logger.info("chat stream: domain={} session={} user={}", domain, req.sessionId, user_id or "-")
    import time as _time

    started = _time.monotonic()

    async def event_generator():
        import asyncio as _asyncio

        queue: _asyncio.Queue = _asyncio.Queue()

        def on_event(event):
            """Agent 每产生一个事件就放入队列，供 generator 实时 yield。"""
            payload = {
                "id": event.id,
                "type": event.type,
                "label": event.label,
                "timestamp": event.timestamp,
            }
            if event.detail is not None:
                payload["detail"] = event.detail
            queue.put_nowait({"event": event.type, "data": _ascii_json(payload)})

        # 后台跑 Agent，事件通过 on_event 实时入队
        task = _asyncio.create_task(
            spec.agent.answer(req.message, session_id=req.sessionId,
                               on_event=on_event, user_id=user_id)
        )

        # 客户端断开（GeneratorExit/CancelledError）时取消后台任务，避免空跑烧 LLM token
        try:
            # 实时推送队列中的事件（逐个 yield，前端看到流式效果）
            while not task.done():
                try:
                    item = await _asyncio.wait_for(queue.get(), timeout=0.5)
                    yield item
                except _asyncio.TimeoutError:
                    continue

            # Agent 完成：排空队列里剩余的事件
            while not queue.empty():
                yield queue.get_nowait()

            # 结束帧（先审计后 yield：即使客户端在 done 帧断连，审计也已落库）
            result = await task
            metrics.observe("chat_duration", (_time.monotonic() - started) * 1000)
            metrics.inc_counter("chat", agent=domain, status="error" if result.error else "ok")
            await _audit_chat(state, user_id, request, req.message, result)
            yield {"event": "done", "data": _ascii_json(result.model_dump())}
        except GeneratorExit:
            metrics.inc_counter("sse_disconnect", agent=domain)
            raise
        finally:
            if not task.done():
                task.cancel()

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

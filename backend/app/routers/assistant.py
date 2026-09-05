"""Pi 智能助手代理：/api/assistant/* → Pi orchestrator（SSE 透传 + 熔断降级）。

鉴权/限流复用现有中间件与限流器；身份经 x-user-id 头透传（权限由 internal 路由反查）。
PI_ORCHESTRATOR_URL 未配置时整体 503 优雅降级，经典 /chat 不受影响。
"""
from __future__ import annotations

import json
import time
import uuid

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger

from app.deps import AppState

router = APIRouter(prefix="/api/assistant")

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}

# 上游业务错误的 SSE 兜底帧（保持事件流契约：error + done 收尾）
_UPSTREAM_ERROR_FRAMES = (
    b'event: error\ndata: {"id":"upstream","type":"error","label":"\xe6\x99\xba\xe8\x83\xbd\xe5\x8a\xa9\xe6\x89\x8b\xe6\x9c\x8d\xe5\x8a\xa1\xe5\xbc\x82\xe5\xb8\xb8"}\n\n'
    b'event: done\ndata: {"sessionId":"","answer":"","events":[],"toolCalls":[],"durationMs":0,"error":"assistant upstream error"}\n\n'
)


class CircuitBreaker:
    """连接失败熔断：连续 fail_threshold 次打开 open_seconds 秒，超时自然半开，成功复位。"""

    def __init__(self, fail_threshold: int = 3, open_seconds: float = 30.0):
        self.fail_threshold = fail_threshold
        self.open_seconds = open_seconds
        self._consecutive = 0
        self._opened_until = 0.0

    def is_open(self, now: float | None = None) -> bool:
        return (now if now is not None else time.monotonic()) < self._opened_until

    def record_failure(self, now: float | None = None) -> None:
        now = now if now is not None else time.monotonic()
        self._consecutive += 1
        if self._consecutive >= self.fail_threshold:
            self._opened_until = now + self.open_seconds
            self._consecutive = 0

    def record_success(self, now: float | None = None) -> None:
        now = now if now is not None else time.monotonic()
        self._consecutive = 0
        self._opened_until = now


# 进程级单例（uvicorn 单进程模型下安全）
_breaker = CircuitBreaker()


class HealthProbe:
    """上游健康探测结果缓存（TTL 内复用，避免每次请求都打 /health）。"""

    def __init__(self, ttl: float = 5.0):
        self.ttl = ttl
        self._ok: bool | None = None
        self._at: float = 0.0

    def cached(self, now: float) -> bool | None:
        """TTL 内返回缓存结果，过期返回 None（需要重新探测）。"""
        if self._ok is not None and now - self._at <= self.ttl:
            return self._ok
        return None

    def update(self, now: float, ok: bool) -> None:
        self._ok = ok
        self._at = now


_probe = HealthProbe()


async def _probe_upstream(base: str, headers: dict) -> bool:
    """GET {base}/health，1.5s 超时；可达且 status=ok 视为健康。"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{base}/health", headers=headers, timeout=1.5)
        return response.status_code == 200
    except httpx.HTTPError:
        return False


async def _try_recover(base: str, headers: dict) -> bool:
    """熔断打开时的恢复路径：探测健康（带缓存）→ 复位熔断。返回是否可放行。"""
    now = time.monotonic()
    ok = _probe.cached(now)
    if ok is None:
        ok = await _probe_upstream(base, headers)
        _probe.update(now, ok)
    if ok:
        _breaker.record_success(now)
        return True
    return False


def _forward_headers(settings, user) -> dict[str, str]:
    return {
        "x-internal-token": settings.INTERNAL_API_TOKEN or "",
        "x-user-id": user.user_id if user else "anonymous",
    }


def _upstream_base(state: AppState) -> str | None:
    return (state.settings.PI_ORCHESTRATOR_URL or "").rstrip("/") or None


def _check_rate_limit(state: AppState, request: Request, user_id: str | None) -> JSONResponse | None:
    limiter = state.rate_limit_chat
    if limiter is None or limiter.limit == 0:
        return None
    key = f"user:{user_id}" if user_id else f"ip:{request.client.host if request.client else 'unknown'}"
    if not limiter.allow(key):
        retry = limiter.retry_after(key)
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry)},
            content={"error": f"请求过于频繁，请 {retry} 秒后重试"},
        )
    return None


@router.post("/chat/stream")
async def assistant_chat_stream(request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用（未配置 PI_ORCHESTRATOR_URL）"})

    user = getattr(request.state, "user", None)
    user_id = user.user_id if user else None
    limited = _check_rate_limit(state, request, user_id)
    if limited:
        return limited

    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message or len(message) > 4000:
        return JSONResponse(status_code=400, content={"error": "message is required (1-4000 chars)"})
    # 新会话由代理生成 sessionId（Node 端校验 ID_RE），done 帧回传后前端记住
    session_id = body.get("sessionId") or uuid.uuid4().hex[:16]

    # 熔断打开时先探测：Node 已恢复则复位放行（≤5s 探测缓存），仍不健康则快速失败
    headers = _forward_headers(state.settings, user)
    if _breaker.is_open() and not await _try_recover(base, headers):
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})

    logger.info("assistant stream: session={} user={}", session_id, user_id or "-")

    async def generator():
        try:
            async with httpx.AsyncClient().stream(
                "POST", f"{base}/sessions/{session_id}/messages",
                headers=headers, json={"message": message},
                timeout=httpx.Timeout(190.0, connect=5.0),
            ) as response:
                if response.status_code != 200:
                    # 上游可达但业务报错（400/404/500…）：转成 error 帧收尾，不计熔断
                    detail = (await response.aread()).decode("utf-8", "replace")
                    _breaker.record_success()
                    try:
                        error_text = json.loads(detail).get("error", detail)
                    except (ValueError, AttributeError):
                        error_text = detail
                    frame = json.dumps({"error": error_text}, ensure_ascii=True)
                    yield f"event: error\ndata: {frame}\n\n".encode()
                else:
                    _breaker.record_success()
                    async for chunk in response.aiter_bytes():
                        yield chunk
        except httpx.HTTPError as exc:
            _breaker.record_failure()
            logger.warning("assistant upstream failure: {}", exc)
            yield _UPSTREAM_ERROR_FRAMES

    return StreamingResponse(generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


async def _upstream_json(method: str, url: str, headers: dict, *, base: str | None = None) -> JSONResponse:
    """带熔断的非流式转发（会话列表/详情/删除）；打开时探测恢复。"""
    if base and _breaker.is_open() and not await _try_recover(base, headers):
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})
    if not base and _breaker.is_open():
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})
    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(method, url, headers=headers, timeout=10)
    except httpx.HTTPError as exc:
        _breaker.record_failure()
        logger.warning("assistant upstream failure: {}", exc)
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})
    _breaker.record_success()
    try:
        content = response.json()
    except ValueError:
        content = {"error": response.text[:500]}
    return JSONResponse(status_code=response.status_code, content=content)


@router.get("/sessions")
async def assistant_sessions(request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用"})
    headers = _forward_headers(state.settings, getattr(request.state, "user", None))
    query = f"?{request.url.query}" if request.url.query else ""
    return await _upstream_json("GET", f"{base}/sessions{query}", headers, base=base)


@router.get("/sessions/{session_id}")
async def assistant_session_detail(session_id: str, request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用"})
    headers = _forward_headers(state.settings, getattr(request.state, "user", None))
    return await _upstream_json("GET", f"{base}/sessions/{session_id}", headers, base=base)


@router.delete("/sessions/{session_id}")
async def assistant_session_delete(session_id: str, request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用"})
    headers = _forward_headers(state.settings, getattr(request.state, "user", None))
    return await _upstream_json("DELETE", f"{base}/sessions/{session_id}", headers, base=base)

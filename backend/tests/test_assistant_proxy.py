"""assistant 代理测试：未启用 503、熔断状态机、转发头构造。"""
from types import SimpleNamespace

from fastapi import Request

from app.routers.assistant import CircuitBreaker, _forward_headers, assistant_chat_stream


def test_circuit_breaker_states():
    breaker = CircuitBreaker(fail_threshold=3, open_seconds=30)
    t = 1000.0
    assert not breaker.is_open(t)
    breaker.record_failure(t)
    breaker.record_failure(t)
    assert not breaker.is_open(t)  # 未达阈值
    breaker.record_failure(t)
    assert breaker.is_open(t)  # 打开
    assert not breaker.is_open(t + 31)  # 超时半开
    breaker.record_success(t + 31)
    assert not breaker.is_open(t + 40)  # 复位


def test_circuit_breaker_success_resets_consecutive():
    breaker = CircuitBreaker(fail_threshold=3)
    breaker.record_failure(1.0)
    breaker.record_failure(2.0)
    breaker.record_success(2.5)
    breaker.record_failure(3.0)
    assert not breaker.is_open(4.0)  # 连续计数已被成功复位


def _request(app_state, headers=None):
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "app": SimpleNamespace(state=SimpleNamespace(app_state=app_state)),
        "client": ("testclient", 123),
    }
    return Request(scope)


def test_forward_headers_injects_identity():
    settings = SimpleNamespace(INTERNAL_API_TOKEN="tok")
    user = SimpleNamespace(user_id="U1", org_id="ORG1")
    headers = _forward_headers(settings, user)
    assert headers["x-internal-token"] == "tok"
    assert headers["x-user-id"] == "U1"


def test_forward_headers_anonymous_when_no_user():
    settings = SimpleNamespace(INTERNAL_API_TOKEN="tok")
    headers = _forward_headers(settings, None)
    assert headers["x-user-id"] == "anonymous"


async def test_stream_503_when_not_configured():
    state = SimpleNamespace(
        settings=SimpleNamespace(PI_ORCHESTRATOR_URL=None, INTERNAL_API_TOKEN="tok"),
        rate_limit_chat=None,
    )
    request = _request(state)
    request.state.user = None

    async def json_body():
        return {"message": "hi"}

    request.json = json_body
    response = await assistant_chat_stream(request)
    assert response.status_code == 503


async def test_stream_rate_limited():
    limiter = SimpleNamespace(
        limit=1,
        allow=lambda key: False,
        retry_after=lambda key: 7,
    )
    state = SimpleNamespace(
        settings=SimpleNamespace(PI_ORCHESTRATOR_URL="http://pi:8090", INTERNAL_API_TOKEN="tok"),
        rate_limit_chat=limiter,
    )
    request = _request(state)
    request.state.user = None

    async def json_body():
        return {"message": "hi"}

    request.json = json_body
    response = await assistant_chat_stream(request)
    assert response.status_code == 429

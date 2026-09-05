"""assistant 代理测试：未启用 503、熔断状态机、健康探测恢复、转发头构造。"""
from types import SimpleNamespace

from fastapi import Request
from starlette.responses import StreamingResponse

from app.routers import assistant
from app.routers.assistant import CircuitBreaker, HealthProbe, _forward_headers, assistant_chat_stream


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


def test_health_probe_cache():
    probe = HealthProbe(ttl=5.0)
    assert probe.cached(100.0) is None  # 无缓存
    probe.update(100.0, True)
    assert probe.cached(104.0) is True  # TTL 内
    assert probe.cached(106.0) is None  # 过期
    probe.update(106.0, False)
    assert probe.cached(107.0) is False


def _reset_singletons():
    """熔断/探测是模块级单例，测试间重置避免缓存泄漏。"""
    assistant._breaker = CircuitBreaker()
    assistant._probe = HealthProbe()


async def test_stream_503_when_breaker_open_and_unhealthy(monkeypatch):
    _reset_singletons()
    assistant._breaker.record_failure()
    assistant._breaker.record_failure()
    assistant._breaker.record_failure()
    assert assistant._breaker.is_open()

    async def unhealthy(base, headers):
        return False

    monkeypatch.setattr(assistant, "_probe_upstream", unhealthy)
    state = SimpleNamespace(
        settings=SimpleNamespace(PI_ORCHESTRATOR_URL="http://pi:8090", INTERNAL_API_TOKEN="tok"),
        rate_limit_chat=None,
    )
    request = _request(state)
    request.state.user = None

    async def json_body():
        return {"message": "hi"}

    request.json = json_body
    response = await assistant_chat_stream(request)
    assert response.status_code == 503
    assert assistant._breaker.is_open()  # 探测不健康，保持熔断


async def test_stream_recovers_when_probe_healthy(monkeypatch):
    _reset_singletons()
    assistant._breaker.record_failure()
    assistant._breaker.record_failure()
    assistant._breaker.record_failure()
    assert assistant._breaker.is_open()

    async def healthy(base, headers):
        return True

    monkeypatch.setattr(assistant, "_probe_upstream", healthy)
    state = SimpleNamespace(
        settings=SimpleNamespace(PI_ORCHESTRATOR_URL="http://pi:8090", INTERNAL_API_TOKEN="tok"),
        rate_limit_chat=None,
    )
    request = _request(state)
    request.state.user = None

    async def json_body():
        return {"message": "hi"}

    request.json = json_body
    response = await assistant_chat_stream(request)
    assert isinstance(response, StreamingResponse)  # 不再 503，进入流式转发
    assert not assistant._breaker.is_open()  # 探测健康，熔断复位


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

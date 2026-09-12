"""internal 路由测试：token 鉴权、身份反查权限、persist=False 透传。"""
from types import SimpleNamespace

from fastapi import Request

from app.auth.org_access import OrgAccess
from app.models.schemas import AgentRunResult
from app.routers.internal import _check_internal_token, _resolve_access, internal_agent_chat


def _request(headers: dict | None = None, app_state=None) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "app": SimpleNamespace(state=SimpleNamespace(app_state=app_state)),
    }
    return Request(scope)


def _state(auth_enabled=True, user=None, spec=None):
    async def find_by_user_id(uid):
        return user

    return SimpleNamespace(
        settings=SimpleNamespace(INTERNAL_API_TOKEN="tok", AUTH_ENABLED=auth_enabled),
        users=SimpleNamespace(find_by_user_id=find_by_user_id) if auth_enabled else None,
        get_agent=lambda domain: spec,
    )


_USER = SimpleNamespace(
    user_id="U1", username="alice", display_name="Alice", role="user", status="active", org_id="ORG1",
)


def test_token_check():
    request = _request({"x-internal-token": "tok"})
    assert _check_internal_token(request, _state().settings) is None
    bad = _request({"x-internal-token": "nope"})
    response = _check_internal_token(bad, _state().settings)
    assert response.status_code == 401
    missing = _request({})
    assert _check_internal_token(missing, _state().settings).status_code == 401
    unconfigured = _request({"x-internal-token": "tok"})
    assert _check_internal_token(unconfigured, SimpleNamespace(INTERNAL_API_TOKEN=None)).status_code == 401


async def test_resolve_access_from_user_lookup():
    state = _state(user=_USER)
    access, user_id, error = await _resolve_access(_request({"x-user-id": "U1"}), state)
    assert error is None
    assert user_id == "U1"
    assert access == OrgAccess("org", "ORG1")


async def test_resolve_access_unknown_user_401():
    state = _state(user=None)
    _, _, response = await _resolve_access(_request({"x-user-id": "GHOST"}), state)
    assert response.status_code == 401


async def test_resolve_access_auth_disabled_unrestricted():
    state = _state(auth_enabled=False)
    access, user_id, error = await _resolve_access(_request({}), state)
    assert error is None
    assert access.mode == "unrestricted"
    assert user_id is None


async def test_internal_agent_chat_persists_with_identity():
    captured = {}

    async def fake_answer(question, **kwargs):
        captured.update(kwargs, question=question)
        return AgentRunResult(sessionId="s1", answer="ok", trace=[], events=[], toolCalls=[], durationMs=1)

    spec = SimpleNamespace(agent=SimpleNamespace(answer=fake_answer))
    state = _state(user=_USER, spec=spec)
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)

    async def json_body():
        return {"message": "赔付率？", "sessionId": "s1"}

    request.json = json_body
    response = await internal_agent_chat("insurance", request)
    assert captured["persist"] is True  # 落库拿 messageId，Pi 模式反馈按钮可用
    assert captured["user_id"] == "U1"
    assert captured["org_access"] == OrgAccess("org", "ORG1")
    assert response.status_code == 200

# --- M2: traditional_query / graph_query internal 端点 ---
from app.routers.internal import internal_graph_neighbors, internal_graph_overview, internal_traditional_query


class _FakeInsurance:
    def __init__(self):
        self.captured = None

    async def query_contract(self, cond, page, page_size, sort_by=None, sort_order=None):
        self.captured = {"cond": cond, "page": page, "pageSize": page_size}
        return {"items": [{"policy_no": "P1"}], "total": 1, "page": page, "pageSize": page_size, "totalPages": 1}


def _state_with_insurance(user=_USER):
    state = _state(user=user)
    state.insurance = _FakeInsurance()
    return state


async def test_internal_traditional_query_ok_and_org_override():
    state = _state_with_insurance()
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)

    async def json_body():
        return {"conditions": {"policyNo": "P1"}, "page": 2, "pageSize": 20}

    request.json = json_body
    response = await internal_traditional_query("contract", request)
    assert response.status_code == 200
    assert state.insurance.captured["cond"]["orgCode"] == "ORG1"  # org 覆盖防伪造
    assert state.insurance.captured["page"] == 2


async def test_internal_traditional_query_deny_403():
    deny_user = SimpleNamespace(**{**_USER.__dict__, "org_id": None})
    state = _state_with_insurance(user=deny_user)
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)

    async def json_body():
        return {}

    request.json = json_body
    response = await internal_traditional_query("contract", request)
    assert response.status_code == 403


async def test_internal_traditional_query_bad_module():
    state = _state_with_insurance()
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)

    async def json_body():
        return {}

    request.json = json_body
    response = await internal_traditional_query("orders", request)
    assert response.status_code == 400


async def test_internal_graph_overview(monkeypatch):
    from app.graph import service as graph_service
    node_rows, edge_rows = [], []
    async def fake_fetch(pool):
        return node_rows, edge_rows
    monkeypatch.setattr(graph_service, "fetch_raw_graph", fake_fetch)
    state = _state_with_insurance()
    state.pool = None
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)
    response = await internal_graph_overview(request)
    assert response.status_code == 200


async def test_internal_graph_unavailable_503(monkeypatch):
    from app.graph import service as graph_service

    def boom(pool):
        raise RuntimeError("AGE not installed")

    monkeypatch.setattr(graph_service, "fetch_raw_graph", boom)
    state = _state_with_insurance()
    state.pool = None
    state.pool = None
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)
    response = await internal_graph_overview(request)
    assert response.status_code == 503


async def test_internal_graph_neighbors_bad_label(monkeypatch):
    from app.graph import service as graph_service
    monkeypatch.setattr(graph_service, "fetch_raw_graph", lambda pool: ([], []))
    state = _state_with_insurance()
    request = _request({"x-user-id": "U1", "x-internal-token": "tok"}, state)
    response = await internal_graph_neighbors(request, "Hacker", "123")
    assert response.status_code == 400

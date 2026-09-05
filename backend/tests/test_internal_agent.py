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


async def test_internal_agent_chat_passes_persist_false():
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
    assert captured["persist"] is False
    assert captured["user_id"] == "U1"
    assert captured["org_access"] == OrgAccess("org", "ORG1")
    assert response.status_code == 200

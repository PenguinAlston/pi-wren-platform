"""AuthMiddleware 集成测试：禁用直通 / 未登录 401 / 合法 Cookie 放行。"""
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.auth.middleware import AuthMiddleware
from app.auth.store import AuthUser
from app.auth.tokens import sign_token


class FakeUserStore:
    def __init__(self, user):
        self._user = user

    async def find_by_user_id(self, user_id):
        return self._user if self._user and self._user.user_id == user_id else None


def _build_app(auth_enabled: bool, user: AuthUser | None):
    app = FastAPI()
    state = SimpleNamespace(
        settings=SimpleNamespace(
            AUTH_ENABLED=auth_enabled,
            AUTH_COOKIE_NAME="piwren_session",
            AUTH_SECRET="test-secret-0123456789abcdef",
        ),
        users=FakeUserStore(user),
    )
    app.state.app_state = state
    app.add_middleware(AuthMiddleware, settings=state.settings, get_state=lambda: state)

    @app.get("/api/hello")
    async def hello(request: Request):
        current = getattr(request.state, "user", None)
        return {"user": current.user_id if current else None}

    return app


_USER = AuthUser(user_id="U1", username="alice", display_name="Alice", role="user", status="active")


def test_disabled_passes_through():
    client = TestClient(_build_app(auth_enabled=False, user=_USER))
    assert client.get("/api/hello").json() == {"user": None}


def test_enabled_without_cookie_401():
    client = TestClient(_build_app(auth_enabled=True, user=_USER))
    response = client.get("/api/hello")
    assert response.status_code == 401
    assert response.json()["authRequired"] is True


def test_enabled_with_valid_cookie_passes():
    secret = "test-secret-0123456789abcdef"
    token = sign_token(secret, "U1", "user", 3600)
    client = TestClient(_build_app(auth_enabled=True, user=_USER))
    response = client.get("/api/hello", cookies={"piwren_session": token})
    assert response.status_code == 200
    assert response.json() == {"user": "U1"}


def test_expired_or_bad_cookie_401():
    secret = "test-secret-0123456789abcdef"
    expired = sign_token(secret, "U1", "user", -10)
    client = TestClient(_build_app(auth_enabled=True, user=_USER))
    assert client.get("/api/hello", cookies={"piwren_session": expired}).status_code == 401
    assert client.get("/api/hello", cookies={"piwren_session": "garbage"}).status_code == 401


def test_disabled_user_token_rejected():
    """用户被禁用后，仍在有效期的令牌也不放行。"""
    secret = "test-secret-0123456789abcdef"
    token = sign_token(secret, "U1", "user", 3600)
    disabled = AuthUser(user_id="U1", username="alice", display_name="Alice",
                        role="user", status="disabled")
    client = TestClient(_build_app(auth_enabled=True, user=disabled))
    assert client.get("/api/hello", cookies={"piwren_session": token}).status_code == 401


def test_health_exempt():
    client = TestClient(_build_app(auth_enabled=True, user=_USER))
    # 测试 app 未挂 /api/health 路由：中间件放行 → 404（而非 401）
    assert client.get("/api/health").status_code == 404

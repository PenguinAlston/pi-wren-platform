"""用户管理路由测试：鉴权、校验规则、自我保护与最后管理员保护。"""
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.auth.store import AuthUser
from app.routers import admin_users


class FakeUserStore:
    def __init__(self, users: dict[str, AuthUser]):
        self.users = users  # user_id -> AuthUser

    async def list_users(self):
        return list(self.users.values())

    async def find_by_username(self, username):
        return next((u for u in self.users.values() if u.username == username), None)

    async def find_by_user_id_uncached(self, user_id):
        return self.users.get(user_id)

    async def create_user(self, username, password, *, role="user", display_name=None):
        uid = f"U-{username}"
        user = AuthUser(user_id=uid, username=username,
                        display_name=display_name or username, role=role, status="active")
        self.users[uid] = user
        return user

    async def update_user(self, user_id, *, role=None, status=None, display_name=None):
        u = self.users[user_id]
        self.users[user_id] = AuthUser(u.user_id, u.username,
                                       display_name or u.display_name, role or u.role, status or u.status)

    async def set_password(self, user_id, password):
        pass

    async def count_active_admins(self):
        return sum(1 for u in self.users.values() if u.role == "admin" and u.status == "active")


class FakeAudit:
    def __init__(self):
        self.calls = []

    async def log(self, *args, **kwargs):
        self.calls.append((args, kwargs))


ADMIN = AuthUser("U-admin", "admin", "管理员", "admin", "active")
ALICE = AuthUser("U-alice", "alice", "Alice", "user", "active")
BOB_ADMIN = AuthUser("U-bob", "bob", "Bob", "admin", "active")


def _build_app(users: dict[str, AuthUser], current: AuthUser | None,
               admin_token: str | None = "secret-token"):
    app = FastAPI()
    store = FakeUserStore(users)
    audit = FakeAudit()
    state = SimpleNamespace(
        settings=SimpleNamespace(ADMIN_TOKEN=admin_token),
        users=store,
        audit=audit,
    )
    app.state.app_state = state
    app.include_router(admin_users.router)

    @app.middleware("http")
    async def inject_user(request: Request, call_next):
        if current is not None:
            request.state.user = current
        return await call_next(request)

    return app, store, audit


def _auth(client_kwargs: dict | None = None) -> dict:
    return {"headers": {"x-admin-token": "secret-token"}, **(client_kwargs or {})}


def test_list_requires_admin():
    app, _, _ = _build_app({"U-alice": ALICE}, current=None, admin_token=None)
    client = TestClient(app)
    assert client.get("/api/admin/users").status_code == 401


def test_disabled_auth_returns_clear_error_not_500():
    """AUTH_ENABLED=false（users=None）时应返回 400 明确提示，而非 AttributeError 500。"""
    app = FastAPI()
    app.state.app_state = SimpleNamespace(
        settings=SimpleNamespace(ADMIN_TOKEN="secret-token"), users=None, audit=None,
    )
    app.include_router(admin_users.router)
    client = TestClient(app)
    response = client.get("/api/admin/users", headers={"x-admin-token": "secret-token"})
    assert response.status_code == 400
    assert "未启用" in response.json()["error"]


def test_admin_session_can_list():
    app, _, _ = _build_app({"U-admin": ADMIN}, current=ADMIN, admin_token=None)
    client = TestClient(app)
    response = client.get("/api/admin/users")
    assert response.status_code == 200
    assert [u["username"] for u in response.json()["users"]] == ["admin"]


def test_create_user_validation_and_success():
    app, store, audit = _build_app({"U-admin": ADMIN}, current=ADMIN)
    client = TestClient(app)
    # 口令过短
    assert client.post("/api/admin/users", json={"username": "carol", "password": "123"}).status_code == 400
    # 非法角色
    assert client.post("/api/admin/users", json={"username": "carol", "password": "12345678", "role": "root"}).status_code == 400
    # 成功 + 审计
    response = client.post("/api/admin/users", json={"username": "carol", "password": "12345678"})
    assert response.status_code == 201
    assert "U-carol" in store.users
    assert audit.calls
    # 重复用户名
    assert client.post("/api/admin/users", json={"username": "carol", "password": "12345678"}).status_code == 409


def test_cannot_disable_or_demote_self():
    app, _, _ = _build_app({"U-admin": ADMIN, "U-bob": BOB_ADMIN}, current=ADMIN)
    client = TestClient(app)
    r = client.put("/api/admin/users/U-admin", json={"status": "disabled"})
    assert r.status_code == 400 and "停用自己" in r.json()["error"]
    r = client.put("/api/admin/users/U-admin", json={"role": "user"})
    assert r.status_code == 400 and "降级自己" in r.json()["error"]


def test_last_active_admin_protected():
    # 只有 ADMIN 一个活跃 admin：停用/降级他人路径——当前操作者是 token（非会话），目标为最后一个 admin
    app, _, _ = _build_app({"U-admin": ADMIN}, current=None)
    client = TestClient(app)
    r = client.put("/api/admin/users/U-admin", json={"status": "disabled"}, **_auth())
    assert r.status_code == 400 and "至少" in r.json()["error"]
    r = client.put("/api/admin/users/U-admin", json={"role": "user"}, **_auth())
    assert r.status_code == 400


def test_demote_admin_ok_when_another_exists():
    app, store, _ = _build_app({"U-admin": ADMIN, "U-bob": BOB_ADMIN}, current=ADMIN)
    client = TestClient(app)
    r = client.put("/api/admin/users/U-bob", json={"role": "user"})
    assert r.status_code == 200
    assert store.users["U-bob"].role == "user"


def test_reset_password_flow():
    app, _, _ = _build_app({"U-admin": ADMIN, "U-alice": ALICE}, current=ADMIN)
    client = TestClient(app)
    assert client.put("/api/admin/users/U-alice/password", json={"password": "short"}).status_code == 400
    assert client.put("/api/admin/users/U-alice/password", json={"password": "new-pass-123"}).status_code == 200
    assert client.put("/api/admin/users/U-none/password", json={"password": "new-pass-123"}).status_code == 404

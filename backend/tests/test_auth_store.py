"""UserStore 真实实现回归：防止 Fake 替身"自带方法"掩盖真实 store 缺方法（历史教训：
admin_users 路由调用 find_by_user_id_uncached 而 Fake 自带实现，真实 store 漏定义未被测试发现）。"""
from app.auth.store import UserStore


class FakeConn:
    def __init__(self, recorder, row=None):
        self._rec = recorder
        self._row = row

    async def execute(self, sql, *args):
        self._rec.append((sql, args))

    async def fetchrow(self, sql, *args):
        self._rec.append((sql, args))
        return self._row

    async def fetchval(self, sql, *args):
        self._rec.append((sql, args))
        return 0


class FakePool:
    def __init__(self, row=None):
        self.calls = []
        self._row = row

    def acquire(self):
        import contextlib

        return contextlib.nullcontext(FakeConn(self.calls, self._row))


def test_admin_surface_methods_exist_on_real_store():
    """管理面路由用到的方法，真实 UserStore 必须全部实现（接口对齐护栏）。"""
    store = UserStore(FakePool())
    for method in ("list_users", "find_by_user_id_uncached", "update_user",
                   "set_password", "count_active_admins"):
        assert callable(getattr(store, method)), f"UserStore 缺少管理面方法: {method}"


async def test_find_uncached_bypasses_cache():
    row = {"user_id": "U1", "username": "alice", "display_name": "Alice",
           "role": "user", "status": "active"}
    pool = FakePool(row=row)
    store = UserStore(pool)
    store._cache["U1"] = (9e9, None)  # 预置一条"永不过期"的脏缓存
    user = await store.find_by_user_id_uncached("U1")
    # 应先失效缓存再查库（有 SQL 执行），且拿到库里的用户
    assert user is not None and user.username == "alice"
    assert any("sys_login_user" in sql for sql, _ in pool.calls)
    assert "U1" not in store._cache or store._cache["U1"][0] < 9e9

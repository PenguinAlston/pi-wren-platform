"""传统查询机构强制测试：builder 注入 orgCode 条件 + UserStore 机构方法（假池）。"""
from app.insurance.service import build_claim_query, build_contract_query, build_preserve_query
from app.auth.store import UserStore


class FakeConn:
    def __init__(self, recorder):
        self._rec = recorder

    async def execute(self, sql, *args):
        self._rec.append((sql, args))

    async def fetchrow(self, sql, *args):
        self._rec.append((sql, args))
        return None

    async def fetchval(self, sql, *args):
        self._rec.append((sql, args))
        return 0


class FakePool:
    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    def acquire(self):
        import contextlib

        return contextlib.nullcontext(FakeConn(self.calls))


# --- builders：orgCode 条件注入 ---


def test_contract_builder_injects_org_code():
    built = build_contract_query({"orgCode": "ORG-A"}, 1, 10)
    assert "p.org_code = $1" in built["sql"] and built["params"] == ["ORG-A"]
    assert "p.org_code = $1" in built["count_sql"]


def test_preserve_builder_injects_org_code():
    built = build_preserve_query({"orgCode": "ORG-A"}, 1, 10)
    assert "m.org_code = $1" in built["sql"] and built["params"] == ["ORG-A"]


def test_claim_builder_injects_org_code():
    built = build_claim_query({"orgCode": "ORG-A"}, 1, 10)
    assert "c.org_code = $1" in built["sql"] and built["params"] == ["ORG-A"]


def test_builder_org_code_combines_with_client_conditions():
    """身份强制 org + 客户端其他条件并存（参数位次正确）。"""
    built = build_claim_query({"orgCode": "ORG-A", "claimStatus": "05"}, 1, 10)
    assert "c.claim_status = $1" in built["sql"] and "c.org_code = $2" in built["sql"]
    assert built["params"] == ["05", "ORG-A"]


def test_claim_select_exposes_org_code():
    """详情归属校验依赖 CLAIM_SELECT 携带 c.org_code。"""
    from app.insurance.service import CLAIM_SELECT
    assert "c.org_code" in CLAIM_SELECT


# --- UserStore 机构方法 ---


async def test_set_org_updates_and_invalidates_cache():
    pool = FakePool()
    store = UserStore(pool)
    store._cache["U1"] = (9e9, None)
    await store.set_org("U1", "ORG-A")
    sql, args = pool.calls[0]
    assert "SET org_id = $1" in sql and args == ("ORG-A", "U1")
    assert "U1" not in store._cache

    await store.set_org("U1", None)
    assert pool.calls[1][1] == (None, "U1"), "org_id=None 表示取消分配"


async def test_org_exists_queries_sys_org():
    pool = FakePool()
    store = UserStore(pool)
    await store.org_exists("ORG-A")
    sql, args = pool.calls[0]
    assert "FROM sys_org" in sql and args == ("ORG-A",)


async def test_create_user_persists_org_id():
    pool = FakePool()
    store = UserStore(pool)
    await store.create_user("bob", "password-123", org_id="ORG-A")
    sql, args = pool.calls[0]
    assert "org_id" in sql and args[-1] == "ORG-A"


async def test_ensure_table_adds_org_column_for_legacy_db():
    pool = FakePool()
    store = UserStore(pool)
    await store.ensure_table()
    alter_calls = [c for c in pool.calls if "ADD COLUMN IF NOT EXISTS org_id" in c[0]]
    assert alter_calls, "存量库需要 ALTER 自愈补 org_id 列"

"""会话归属与 DbSessionStore 写入参数测试（纯函数 + 假池，不依赖真实 DB）。"""
import json

import pytest

from app.session.db_store import DbSessionStore, can_access_session


# --- 归属判定（纯函数）---


def test_owner_can_access():
    assert can_access_session("U1", "U1", is_admin=False) is True


def test_other_user_blocked():
    assert can_access_session("U1", "U2", is_admin=False) is False


def test_legacy_null_owner_blocked_for_user():
    """认证启用前的历史会话（owner=NULL）普通用户不可访问。"""
    assert can_access_session(None, "U1", is_admin=False) is False


def test_admin_accesses_all():
    assert can_access_session("U1", "ADMIN", is_admin=True) is True
    assert can_access_session(None, "ADMIN", is_admin=True) is True


def test_anonymous_never_accesses():
    assert can_access_session("U1", None, is_admin=False) is False


# --- DbSessionStore（假池记录 SQL 与参数）---


class FakeConn:
    def __init__(self, recorder):
        self._rec = recorder

    async def execute(self, sql, *args):
        self._rec.append((sql, args))

    async def fetch(self, sql, *args):
        self._rec.append((sql, args))
        return []

    async def fetchrow(self, sql, *args):
        self._rec.append((sql, args))
        return None

    def transaction(self):
        import contextlib

        return contextlib.nullcontext()


class FakePool:
    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []

    def acquire(self):
        import contextlib

        return contextlib.nullcontext(FakeConn(self.calls))


@pytest.fixture()
def pool():
    return FakePool()


async def test_save_records_owner_and_agent(pool):
    store = DbSessionStore(pool)
    await store.save("s-1", "各险种赔付率？", "结论…", "SELECT 1", [{"x": 1}],
                     agent_id="insurance", user_id="U9")
    session_sql = pool.calls[0][0]
    args = pool.calls[0][1]
    assert "INSERT INTO ai_chat_session" in session_sql
    assert "user_id" in session_sql
    assert args[0] == "s-1" and args[1] == "U9" and args[2] == "insurance"
    # 消息明细写入 data_json
    msg_sql, msg_args = pool.calls[1]
    assert "INSERT INTO ai_chat_message" in msg_sql
    assert json.loads(msg_args[4]) == [{"x": 1}]


async def test_save_without_user(pool):
    """未启用认证时 user_id 为 None（兼容旧行为）。"""
    store = DbSessionStore(pool)
    await store.save("s-2", "q", "a", None, [])
    assert pool.calls[0][1][1] is None


async def test_list_sessions_filters_by_user(pool):
    store = DbSessionStore(pool)
    await store.list_sessions(agent_id="insurance", user_id="U9")
    sql, args = pool.calls[0]
    assert "s.user_id = $2" in sql and "s.agent_id = $1" in sql
    assert args == ("insurance", "U9")


async def test_list_sessions_no_filter(pool):
    store = DbSessionStore(pool)
    await store.list_sessions()
    sql, args = pool.calls[0]
    # 无过滤条件：WHERE 仅剩软删除标记
    assert "s.agent_id =" not in sql and "s.user_id =" not in sql
    assert args == ()


async def test_invalid_session_id_rejected(pool):
    store = DbSessionStore(pool)
    with pytest.raises(ValueError):
        await store.save("../escape", "q", "a", None, [])

"""FeedbackStore 与反馈归属校验测试（纯函数 + 假池，不依赖真实 DB）。"""
import pytest

from app.session.feedback_store import FeedbackStore


class FakeConn:
    def __init__(self, recorder, rows=None):
        self._rec = recorder
        self._rows = rows or []

    async def execute(self, sql, *args):
        self._rec.append((sql, args))
        return "UPDATE 1"

    async def fetch(self, sql, *args):
        self._rec.append((sql, args))
        return self._rows

    async def fetchrow(self, sql, *args):
        self._rec.append((sql, args))
        return None

    async def fetchval(self, sql, *args):
        self._rec.append((sql, args))
        return None


class FakePool:
    def __init__(self, rows=None):
        self.calls: list[tuple[str, tuple]] = []
        self._rows = rows or []

    def acquire(self):
        import contextlib

        return contextlib.nullcontext(FakeConn(self.calls, self._rows))


async def test_set_feedback_upsert_sql(pool=None):
    store = FeedbackStore(FakePool())
    await store.set_feedback("s-1", 7, -1, "U9", "答错了")
    sql, args = store._pool.calls[0]
    assert "INSERT INTO ai_chat_feedback" in sql
    assert "ON CONFLICT (message_id) DO UPDATE" in sql
    assert args == (7, "s-1", "U9", -1, "答错了")


async def test_set_feedback_without_user_and_comment():
    store = FeedbackStore(FakePool())
    await store.set_feedback("s-1", 7, 1, None, None)
    assert store._pool.calls[0][1][2] is None and store._pool.calls[0][1][4] is None


async def test_clear_feedback_delete_sql():
    store = FeedbackStore(FakePool())
    await store.clear_feedback(7)
    sql, args = store._pool.calls[0]
    assert "DELETE FROM ai_chat_feedback" in sql and args == (7,)


async def test_message_session_queries_by_id():
    store = FeedbackStore(FakePool())
    await store.message_session(7)
    sql, args = store._pool.calls[0]
    assert "SELECT session_id FROM ai_chat_message" in sql and args == (7,)


async def test_list_feedback_filters_rating():
    store = FeedbackStore(FakePool())
    await store.list_feedback(rating=-1, limit=10)
    sql, args = store._pool.calls[0]
    assert "f.rating = $1" in sql and args == (-1, 10)


async def test_list_feedback_no_rating_no_where():
    store = FeedbackStore(FakePool())
    await store.list_feedback()
    sql, args = store._pool.calls[0]
    assert "f.rating =" not in sql and args == (50,)


async def test_ensure_table_creates_feedback():
    store = FeedbackStore(FakePool())
    await store.ensure_table()
    sql = store._pool.calls[0][0]
    assert "CREATE TABLE IF NOT EXISTS ai_chat_feedback" in sql
    assert "UNIQUE (message_id)" in sql

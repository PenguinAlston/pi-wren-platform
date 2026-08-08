"""jsonl_store 测试（会话持久化 CRUD）。"""
import pytest

from app.session.jsonl_store import JsonlSessionStore


@pytest.fixture
async def store(tmp_path):
    return JsonlSessionStore(tmp_path / "sessions")


async def test_save_and_get_history(store):
    await store.save("s-1", "问题一", "答案一", "SELECT 1", [{"a": 1}])
    await store.save("s-1", "问题二", "答案二", "SELECT 2", [])
    history = await store.get_history("s-1")
    assert len(history) == 2
    assert history[0]["question"] == "问题一"
    assert history[1]["question"] == "问题二"
    assert history[0]["data"] == [{"a": 1}]


async def test_get_latest(store):
    await store.save("s-1", "q1", "a1", None, [])
    await store.save("s-1", "q2", "a2", None, [])
    latest = await store.get("s-1")
    assert latest["question"] == "q2"


async def test_list_sessions_default_name(store):
    await store.save("s-1", "按险种统计保单数量", "答案", None, [])
    sessions = await store.list_sessions()
    assert len(sessions) == 1
    assert sessions[0]["name"] == "按险种统计保单数量"
    assert sessions[0]["messageCount"] == 1


async def test_rename_and_get_session(store):
    await store.save("s-1", "问题", "答案", None, [])
    await store.rename("s-1", "我的会话")
    session = await store.get_session("s-1")
    assert session["name"] == "我的会话"
    assert len(session["records"]) == 1


async def test_delete(store):
    await store.save("s-1", "q", "a", None, [])
    assert await store.delete("s-1") is True
    assert await store.delete("s-1") is False
    assert await store.get_history("s-1") == []


async def test_invalid_session_id_rejected(store):
    with pytest.raises(ValueError):
        await store.save("../evil", "q", "a", None, [])


async def test_unknown_session_returns_empty(store):
    assert await store.get_history("nope") == []
    assert await store.get("nope") is None

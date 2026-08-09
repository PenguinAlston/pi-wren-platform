"""PostgreSQL 会话仓库（替代 JsonlSessionStore）。

方法签名与 JsonlSessionStore 完全一致（duck typing），路由与 Agent 调用方零改动。
两表模型：ai_chat_session（会话主表）+ ai_chat_message（每轮对话明细）。
"""
from __future__ import annotations

import json
import re
from typing import Any

import asyncpg

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_DEFAULT_AGENT_ID = "insurance"


def _default_name(question: str) -> str:
    single = " ".join(question.split())
    return single[:30] + "…" if len(single) > 30 else single


class DbSessionStore:
    """PostgreSQL 多轮会话仓库：save/get/get_history/list/rename/delete。"""

    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    # --- 写 ---
    async def save(self, session_id: str, question: str, answer: str, sql: str | None,
                   data: list, agent_id: str | None = None) -> None:
        """追加一轮对话。首次写入时建会话主表行（ON CONFLICT DO NOTHING）。"""
        if not _SESSION_ID_RE.match(session_id):
            raise ValueError(f"invalid sessionId: {session_id}")
        aid = agent_id or _DEFAULT_AGENT_ID
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # 会话主表行：首次用首条 question 作默认名（若已存在则保持原 session_name）
                await conn.execute(
                    """
                    INSERT INTO ai_chat_session (session_id, agent_id, session_name, create_time, update_time)
                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (session_id) DO UPDATE SET update_time = CURRENT_TIMESTAMP
                    """,
                    session_id, aid, _default_name(question),
                )
                await conn.execute(
                    """
                    INSERT INTO ai_chat_message (session_id, question, answer, sql_text, data_json, create_time)
                    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                    """,
                    session_id, question, answer, sql,
                    json.dumps(data, ensure_ascii=False) if data else None,
                )

    async def rename(self, session_id: str, name: str) -> None:
        if not _SESSION_ID_RE.match(session_id):
            raise ValueError("invalid sessionId")
        title = name.strip()
        if not title:
            raise ValueError("name is required")
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "UPDATE ai_chat_session SET session_name = $1, update_time = CURRENT_TIMESTAMP "
                "WHERE session_id = $2",
                title, session_id,
            )
            if result == "UPDATE 0":
                raise FileNotFoundError("session not found")

    async def delete(self, session_id: str) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM ai_chat_session WHERE session_id = $1", session_id,
            )
            return result == "DELETE 1"

    # --- 读 ---
    async def get_history(self, session_id: str) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT question, answer, sql_text, data_json, create_time
                FROM ai_chat_message WHERE session_id = $1 ORDER BY create_time, id
                """,
                session_id,
            )
        return [self._row_to_record(r) for r in rows]

    async def get(self, session_id: str) -> dict | None:
        records = await self.get_history(session_id)
        return records[-1] if records else None

    async def list_sessions(self, agent_id: str | None = None) -> list[dict]:
        """会话列表（按 update_time 倒序）。agent_id 非空时仅返回该 Agent 的会话。"""
        async with self._pool.acquire() as conn:
            if agent_id is not None:
                rows = await conn.fetch(
                    """
                    SELECT s.session_id, s.session_name, s.agent_id, s.create_time, s.update_time,
                           COALESCE(c.cnt, 0) AS message_count
                    FROM ai_chat_session s
                    LEFT JOIN (SELECT session_id, COUNT(*) AS cnt FROM ai_chat_message GROUP BY session_id) c
                      ON c.session_id = s.session_id
                    WHERE s.agent_id = $1 AND COALESCE(s.is_delete, '0') = '0'
                    ORDER BY s.update_time DESC
                    """,
                    agent_id,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT s.session_id, s.session_name, s.agent_id, s.create_time, s.update_time,
                           COALESCE(c.cnt, 0) AS message_count
                    FROM ai_chat_session s
                    LEFT JOIN (SELECT session_id, COUNT(*) AS cnt FROM ai_chat_message GROUP BY session_id) c
                      ON c.session_id = s.session_id
                    WHERE COALESCE(s.is_delete, '0') = '0'
                    ORDER BY s.update_time DESC
                    """,
                )
        summaries: list[dict] = []
        for r in rows:
            name = r["session_name"]
            if not name:
                # 无显式名时，用首条 question 截断作默认名
                first_q = await self._first_question(r["session_id"])
                name = _default_name(first_q or "")
            summaries.append({
                "sessionId": r["session_id"],
                "name": name,
                "createdAt": r["create_time"].isoformat() if r["create_time"] else "",
                "updatedAt": r["update_time"].isoformat() if r["update_time"] else "",
                "messageCount": r["message_count"],
                "agentId": r["agent_id"],
            })
        return summaries

    async def get_session(self, session_id: str) -> dict | None:
        async with self._pool.acquire() as conn:
            sess = await conn.fetchrow(
                "SELECT session_name FROM ai_chat_session WHERE session_id = $1", session_id,
            )
            if not sess:
                return None
            rows = await conn.fetch(
                """
                SELECT question, answer, sql_text, data_json, create_time
                FROM ai_chat_message WHERE session_id = $1 ORDER BY create_time, id
                """,
                session_id,
            )
        name = sess["session_name"]
        records = [self._row_to_record(r) for r in rows]
        if not name and records:
            name = _default_name(records[0].get("question", ""))
        return {"name": name or "", "records": records}

    # --- 内部 ---
    async def _first_question(self, session_id: str) -> str | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT question FROM ai_chat_message WHERE session_id = $1 "
                "ORDER BY create_time, id LIMIT 1",
                session_id,
            )
        return row["question"] if row else None

    @staticmethod
    def _row_to_record(row: asyncpg.Record) -> dict[str, Any]:
        """数据库行 → 与 jsonl record 一致的 dict（前端/详情端点消费此结构）。"""
        data: Any = None
        if row["data_json"]:
            try:
                data = json.loads(row["data_json"])
            except (json.JSONDecodeError, TypeError):
                data = None
        return {
            "sessionId": None,  # 调用方按需填，列表/详情端点不依赖此字段
            "question": row["question"] or "",
            "answer": row["answer"] or "",
            "sql": row["sql_text"],
            "data": data if isinstance(data, list) else [],
            "createdAt": row["create_time"].isoformat() if row["create_time"] else "",
        }

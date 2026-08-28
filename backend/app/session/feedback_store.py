"""AI 问答反馈仓库：ai_chat_feedback 表（可写池，效果闭环）。

ensure_table 自愈同 UserStore：新库由 docker init 建表（DDL 维护在
infra/postgres/insurance_schema.sql），存量库启动时 CREATE TABLE IF NOT EXISTS 补齐。
每条回答一条反馈（UNIQUE(message_id)），重复提交 UPSERT 覆盖。
"""
from __future__ import annotations

import asyncpg


class FeedbackStore:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def ensure_table(self) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ai_chat_feedback (
                    id          bigserial PRIMARY KEY,
                    message_id  bigint NOT NULL REFERENCES ai_chat_message(id) ON DELETE CASCADE,
                    session_id  varchar(64) NOT NULL,
                    user_id     varchar(64),
                    rating      smallint NOT NULL CHECK (rating IN (1, -1)),
                    comment     text,
                    created_at  timestamp DEFAULT CURRENT_TIMESTAMP,
                    updated_at  timestamp DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (message_id)
                )
                """
            )

    async def set_feedback(self, session_id: str, message_id: int, rating: int,
                           user_id: str | None, comment: str | None = None) -> None:
        """写入/覆盖反馈（消息归属由路由先行校验）。"""
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ai_chat_feedback (message_id, session_id, user_id, rating, comment)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (message_id) DO UPDATE SET
                    session_id = EXCLUDED.session_id,
                    user_id = EXCLUDED.user_id,
                    rating = EXCLUDED.rating,
                    comment = EXCLUDED.comment,
                    updated_at = CURRENT_TIMESTAMP
                """,
                message_id, session_id, user_id, rating, comment,
            )

    async def clear_feedback(self, message_id: int) -> bool:
        """清除反馈（同值再点取消 / 前端回退）。"""
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM ai_chat_feedback WHERE message_id = $1", message_id,
            )
            return result == "DELETE 1"

    async def message_session(self, message_id: int) -> str | None:
        """消息所属会话（归属校验用；消息不存在返回 None）。"""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT session_id FROM ai_chat_message WHERE id = $1", message_id,
            )
        return row["session_id"] if row else None

    async def list_feedback(self, rating: int | None = None, limit: int = 50) -> list[dict]:
        """反馈清单（复盘用，附问题与回答摘要），按提交时间倒序。"""
        base = """
                SELECT f.message_id, f.session_id, f.user_id, f.rating, f.comment,
                       f.created_at, m.question, m.answer
                FROM ai_chat_feedback f JOIN ai_chat_message m ON m.id = f.message_id
                """
        async with self._pool.acquire() as conn:
            if rating is not None:
                rows = await conn.fetch(
                    base + " WHERE f.rating = $1 ORDER BY f.created_at DESC LIMIT $2",
                    rating, limit,
                )
            else:
                rows = await conn.fetch(
                    base + " ORDER BY f.created_at DESC LIMIT $1", limit,
                )
        return [
            {
                "messageId": r["message_id"],
                "sessionId": r["session_id"],
                "userId": r["user_id"],
                "rating": r["rating"],
                "comment": r["comment"],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else "",
                "question": r["question"] or "",
                "answer": (r["answer"] or "")[:200],
            }
            for r in rows
        ]

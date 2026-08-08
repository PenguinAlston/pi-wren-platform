"""sys_agent_config 数据访问（对应 TS services/agent-registry/src/store.ts）。

project_json 列存 WrenAI 工程序列化 JSON（用户注册时提交）。
"""
from __future__ import annotations

from typing import Any

import asyncpg


class AgentConfigStore:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def list(self) -> list[dict[str, Any]]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, agent_id, name, label, description, system_prompt, "
                "project_json, db_connection_enc, status, last_error, owner_id, "
                "created_at, updated_at FROM sys_agent_config ORDER BY created_at ASC"
            )
        return [self._row_to_record(r) for r in rows]

    async def find_by_agent_id(self, agent_id: str) -> dict[str, Any] | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, agent_id, name, label, description, system_prompt, "
                "project_json, db_connection_enc, status, last_error, owner_id, "
                "created_at, updated_at FROM sys_agent_config WHERE agent_id = $1",
                agent_id,
            )
        return self._row_to_record(row) if row else None

    async def create(self, record: dict[str, Any]) -> dict[str, Any]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO sys_agent_config "
                "(agent_id, name, label, description, system_prompt, project_json, "
                "db_connection_enc, status, last_error, owner_id) "
                "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) "
                "RETURNING id, agent_id, name, label, description, system_prompt, "
                "project_json, db_connection_enc, status, last_error, owner_id, "
                "created_at, updated_at",
                record["agentId"], record["name"], record["label"],
                record.get("description"), record.get("systemPrompt"),
                record["projectJson"], record["dbConnectionEnc"],
                record.get("status", "enabled"), record.get("lastError"),
                record.get("ownerId"),
            )
        return self._row_to_record(row)

    async def update(self, agent_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        sets: list[str] = []
        values: list[Any] = []
        field_map = {
            "name": "name", "label": "label", "description": "description",
            "systemPrompt": "system_prompt", "projectJson": "project_json",
            "dbConnectionEnc": "db_connection_enc", "status": "status",
            "lastError": "last_error", "ownerId": "owner_id",
        }
        for key, column in field_map.items():
            if key in patch:
                values.append(patch[key])
                sets.append(f"{column} = ${len(values)}")
        if not sets:
            return await self.find_by_agent_id(agent_id)
        values.append(agent_id)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"UPDATE sys_agent_config SET {', '.join(sets)}, updated_at = now() "
                f"WHERE agent_id = ${len(values)} RETURNING id, agent_id, name, label, "
                "description, system_prompt, project_json, db_connection_enc, status, "
                "last_error, owner_id, created_at, updated_at",
                *values,
            )
        return self._row_to_record(row) if row else None

    async def delete(self, agent_id: str) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute("DELETE FROM sys_agent_config WHERE agent_id = $1", agent_id)
        return "DELETE 1" in result

    @staticmethod
    def _row_to_record(row: asyncpg.Record) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "agentId": row["agent_id"],
            "name": row["name"],
            "label": row["label"],
            "description": row["description"],
            "systemPrompt": row["system_prompt"],
            "projectJson": row["project_json"],
            "dbConnectionEnc": row["db_connection_enc"],
            "status": row["status"],
            "lastError": row["last_error"],
            "ownerId": row["owner_id"],
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
        }

"""管理操作审计（对应 TS services/agent-registry/src/audit.ts）。

写入 sys_operation_log；失败不阻断业务。
"""
from __future__ import annotations

import asyncpg
from loguru import logger


class OperationAuditLogger:
    def __init__(self, pool: asyncpg.Pool, user_id: str = "UADMIN"):
        self._pool = pool
        self._user_id = user_id

    async def log(self, oper_type: str, oper_content: str, sql_content: str | None = None,
                  ip_address: str | None = None) -> None:
        try:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO sys_operation_log "
                    "(user_id, oper_type, oper_content, sql_content, ip_address, created_at) "
                    "VALUES ($1,$2,$3,$4,$5, now())",
                    self._user_id, oper_type, oper_content, sql_content, ip_address,
                )
        except Exception as e:
            logger.warning("审计写入失败（不阻断）: {}", e)

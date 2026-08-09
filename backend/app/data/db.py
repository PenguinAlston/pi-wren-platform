"""asyncpg 连接池（数据层）。

- create_pool：通用连接池，默认只读（default_transaction_read_only=on），
  供 WrenAI 内省 / 连接探测等临时或只读场景使用。
- create_default_pool / create_writable_pool：由 Settings 构造应用级池，
  分别服务传统查询（只读）与自定义 Agent 注册表 / 审计（可写）。
"""
from __future__ import annotations

from typing import Any

import asyncpg

from app.config import Settings


async def create_pool(
    *,
    host: str = "localhost",
    port: int = 5432,
    database: str,
    user: str,
    password: str,
    max_size: int = 10,
    read_only: bool = True,
    connect_timeout: int = 30,
) -> asyncpg.Pool:
    """创建 asyncpg 连接池。

    read_only=True 时通过 server_settings 把连接默认事务设为只读，
    从数据库层阻止传统查询/内省误写。
    """
    kwargs: dict[str, Any] = {
        "host": host,
        "port": port,
        "database": database,
        "user": user,
        "password": password,
        "min_size": 1,
        "max_size": max_size,
        "timeout": connect_timeout,
        "command_timeout": 30,
    }
    if read_only:
        kwargs["server_settings"] = {"default_transaction_read_only": "on"}
    return await asyncpg.create_pool(**kwargs)


async def create_default_pool(settings: Settings) -> asyncpg.Pool:
    """应用默认只读连接池（传统查询 / 语义执行）。"""
    return await create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        database=settings.DB_NAME,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        read_only=True,
    )


async def create_writable_pool(settings: Settings) -> asyncpg.Pool:
    """可写连接池（自定义 Agent 注册表 / 审计写入）。"""
    return await create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        database=settings.DB_NAME,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        read_only=False,
    )

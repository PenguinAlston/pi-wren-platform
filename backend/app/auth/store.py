"""用户存储：sys_login_user 表（PostgreSQL，可写池）。

ensure_table 在启动时执行 CREATE TABLE IF NOT EXISTS，
DDL 同步维护在 infra/postgres/auth_schema.sql（新库由 docker init 自动建表，
存量库靠 ensure_table 补齐，无需手工迁移）。
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass

import asyncpg
from loguru import logger

from app.auth.passwords import hash_password

_USER_TTL_SECONDS = 60  # 按 user_id 查询的内存缓存（中间件每请求校验，避免热点查库）


@dataclass
class AuthUser:
    user_id: str
    username: str
    display_name: str
    role: str  # admin | user
    status: str  # active | disabled


class UserStore:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool
        self._cache: dict[str, tuple[float, AuthUser | None]] = {}

    async def ensure_table(self) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sys_login_user (
                    user_id       varchar(64) PRIMARY KEY,
                    username      varchar(64) NOT NULL UNIQUE,
                    password_hash text NOT NULL,
                    display_name  varchar(128),
                    role          varchar(16) NOT NULL DEFAULT 'user',
                    status        varchar(16) NOT NULL DEFAULT 'active',
                    created_at    timestamp DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    async def bootstrap_admin(self, username: str, password: str | None) -> None:
        """用户表为空时创建初始管理员。为空且未配置口令 → 报错退出（避免弱默认口令）。"""
        async with self._pool.acquire() as conn:
            count = await conn.fetchval("SELECT COUNT(*) FROM sys_login_user")
        if count:
            return
        if not password or len(password) < 8:
            raise RuntimeError(
                "AUTH_ENABLED=true 且用户表为空：必须配置 AUTH_ADMIN_PASSWORD（≥8 位）用于创建初始管理员"
            )
        await self.create_user(username, password, role="admin", display_name="系统管理员")
        logger.info("已创建初始管理员账号: {}", username)

    def _new_user_id(self) -> str:
        return f"U{secrets.token_hex(8)}"

    async def create_user(self, username: str, password: str, *,
                          role: str = "user", display_name: str | None = None) -> AuthUser:
        user_id = self._new_user_id()
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO sys_login_user (user_id, username, password_hash, display_name, role, status)
                VALUES ($1, $2, $3, $4, $5, 'active')
                """,
                user_id, username, hash_password(password), display_name or username, role,
            )
        return AuthUser(user_id=user_id, username=username,
                        display_name=display_name or username, role=role, status="active")

    async def find_by_username(self, username: str) -> AuthUser | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT user_id, username, display_name, role, status "
                "FROM sys_login_user WHERE username = $1", username,
            )
        return self._to_user(row)

    async def get_password_hash(self, user_id: str) -> str:
        """登录校验专用（AuthUser 不携带口令哈希，避免误用/泄露）。"""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT password_hash FROM sys_login_user WHERE user_id = $1", user_id,
            )
        return row["password_hash"] if row else ""

    async def find_by_user_id(self, user_id: str) -> AuthUser | None:
        """带 60s 内存缓存（中间件每请求调用）。disabled 用户缓存时间窗口内仍有效。"""
        cached = self._cache.get(user_id)
        now = time.time()
        if cached and cached[0] > now:
            return cached[1]
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT user_id, username, display_name, role, status "
                "FROM sys_login_user WHERE user_id = $1", user_id,
            )
        user = self._to_user(row)
        self._cache[user_id] = (now + _USER_TTL_SECONDS, user)
        return user

    # --- 管理面（/api/admin/users）---

    async def find_by_user_id_uncached(self, user_id: str) -> AuthUser | None:
        """管理面用（绕过缓存，保证刚改完的角色/状态立即生效）。"""
        self._cache.pop(user_id, None)
        return await self.find_by_user_id(user_id)

    async def list_users(self) -> list[AuthUser]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT user_id, username, display_name, role, status "
                "FROM sys_login_user ORDER BY created_at, user_id"
            )
        return [u for u in (self._to_user(r) for r in rows) if u]

    async def update_user(self, user_id: str, *,
                          role: str | None = None, status: str | None = None,
                          display_name: str | None = None) -> None:
        """更新后使缓存失效，角色/状态变更立即生效。"""
        async with self._pool.acquire() as conn:
            if role is not None:
                await conn.execute("UPDATE sys_login_user SET role = $1 WHERE user_id = $2", role, user_id)
            if status is not None:
                await conn.execute("UPDATE sys_login_user SET status = $1 WHERE user_id = $2", status, user_id)
            if display_name is not None:
                await conn.execute("UPDATE sys_login_user SET display_name = $1 WHERE user_id = $2",
                                   display_name, user_id)
        self._cache.pop(user_id, None)

    async def set_password(self, user_id: str, password: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE sys_login_user SET password_hash = $1 WHERE user_id = $2",
                hash_password(password), user_id,
            )

    async def count_active_admins(self) -> int:
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT COUNT(*) FROM sys_login_user WHERE role = 'admin' AND status = 'active'"
            )

    @staticmethod
    def _to_user(row) -> AuthUser | None:
        if not row:
            return None
        return AuthUser(
            user_id=row["user_id"], username=row["username"],
            display_name=row["display_name"] or row["username"],
            role=row["role"], status=row["status"],
        )

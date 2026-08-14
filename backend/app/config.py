"""环境配置（对应 TS apps/api/src/config.ts）。

用 pydantic-settings 校验 .env，API 服务通过 Settings() 单例读取。
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _repo_root_candidates() -> list[Path]:
    """仓库根候选：cwd / cwd.parent / cwd.parent.parent（兼容从 backend/ 或 apps/api/ 启动）。"""
    cwd = Path.cwd()
    return [cwd, cwd.parent, cwd.parent.parent]


def _load_env_to_environ():
    """显式把 .env 加载到 os.environ（仅对未设置或空字符串的 key）。

    解决系统环境变量空字符串（如 OPENAI_API_KEY=""）覆盖 .env 值的问题。
    """
    for base in _repo_root_candidates():
        candidate = base / ".env"
        if candidate.exists():
            from dotenv import dotenv_values

            for key, value in dotenv_values(candidate).items():
                current = os.environ.get(key)
                if not current:  # 未设置或空字符串 → 用 .env 值
                    os.environ[key] = value
            return candidate
    return None


_load_env_to_environ()


def _find_env_file() -> Path | None:
    """优先进程 cwd，其次仓库根（backend -> ../.env）。"""
    for base in _repo_root_candidates():
        candidate = base / ".env"
        if candidate.exists():
            return candidate
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_find_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- API ---
    NODE_ENV: str = "development"
    PORT: int = 8080
    LOG_LEVEL: str = "info"
    CORS_ORIGIN: str = "http://localhost:3000"

    # --- PostgreSQL ---
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_NAME: str = "piwren"
    DB_USER: str = "demo"
    DB_PASSWORD: str = "demo"

    # --- WrenAI ---
    WREN_PROJECT_DIR: str = "semantic/wren"
    # strict mode：fail-closed 表白名单（仅工程内表/视图）+ 危险函数拦截（read_csv/dblink 等数据外读）
    WREN_STRICT_MODE: bool = True
    # 额外拒绝的函数（逗号分隔，叠加到 wren 内置黑名单之上）
    WREN_DENIED_FUNCTIONS: str = ""

    # --- AI 查询硬约束 ---
    # 行数上限：防"列出全部保单"类查询打爆内存/前端；达到上限时结果会被截断并提示
    AI_QUERY_ROW_LIMIT: int = Field(500, ge=1, le=10000)
    # 语句超时（秒）：覆盖 wren 连接器默认的 180s，与只读池 command_timeout 对齐
    AI_QUERY_TIMEOUT_SECONDS: int = Field(30, ge=1, le=600)
    # WrenEngine 引擎池大小：每引擎一条 psycopg 连接（懒创建），并发查询轮询分发
    AI_ENGINE_POOL_SIZE: int = Field(4, ge=1, le=32)

    # --- 限流（滑动窗口，进程内存；0 = 关闭）---
    RATE_LIMIT_CHAT_PER_MIN: int = Field(12, ge=0)
    RATE_LIMIT_LOGIN_PER_MIN: int = Field(10, ge=0)

    # --- LLM（统一走 OpenAI 兼容接口：base_url 可指向 DashScope/DeepSeek/vLLM 等）---
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    OPENAI_MODEL: str | None = "glm-5.2"

    @field_validator("OPENAI_API_KEY", "ADMIN_TOKEN", "AGENT_SECRET_KEY", "AUTH_SECRET", "AUTH_ADMIN_PASSWORD", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        """空字符串环境变量（系统级覆盖）视为 None，让 .env 文件值生效。"""
        return None if (isinstance(v, str) and v.strip() == "") else v

    # --- Session & Custom Agents ---
    ADMIN_TOKEN: str | None = None
    AGENT_SECRET_KEY: str | None = Field(None, min_length=8)
    AUDIT_USER_ID: str = "UADMIN"

    # --- 用户认证（AUTH_ENABLED=true 时聊天/会话/传统查询均需登录）---
    AUTH_ENABLED: bool = False
    AUTH_SECRET: str | None = Field(None, min_length=16)  # 会话 Cookie 签名密钥
    AUTH_ADMIN_USERNAME: str = "admin"
    AUTH_ADMIN_PASSWORD: str | None = None  # 首次启动引导管理员口令（用户表为空时必需）
    AUTH_SESSION_HOURS: int = Field(12, ge=1, le=168)
    AUTH_COOKIE_NAME: str = "piwren_session"

    @property
    def wren_project_path(self) -> Path:
        """WrenAI 工程目录绝对路径（相对 cwd 解析，兼容从 backend/ 启动）。"""
        p = Path(self.WREN_PROJECT_DIR)
        if p.is_absolute():
            return p
        cwd = Path.cwd()
        for base in [cwd, cwd.parent, cwd.parent.parent]:
            candidate = base / self.WREN_PROJECT_DIR
            if (candidate / "wren_project.yml").exists():
                return candidate.resolve()
        return (cwd / self.WREN_PROJECT_DIR).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()

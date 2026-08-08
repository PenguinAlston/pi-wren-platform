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
    WREN_BIN: str = "wren"
    WREN_PROJECT_DIR: str = "semantic/wren"

    # --- LLM ---
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    OPENAI_MODEL: str | None = "glm-5.2"
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_MODEL: str | None = None
    OLLAMA_BASE_URL: str | None = "http://localhost:11434"
    OLLAMA_MODEL: str | None = "qwen2.5:7b"

    @field_validator("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ADMIN_TOKEN", "AGENT_SECRET_KEY", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        """空字符串环境变量（系统级覆盖）视为 None，让 .env 文件值生效。"""
        return None if (isinstance(v, str) and v.strip() == "") else v

    # --- Session & Custom Agents ---
    SESSION_DIR: str | None = None
    ADMIN_TOKEN: str | None = None
    AGENT_SECRET_KEY: str | None = Field(None, min_length=8)
    AUDIT_USER_ID: str = "UADMIN"

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

    @property
    def sessions_root(self) -> Path:
        return Path(self.SESSION_DIR) if self.SESSION_DIR else Path.cwd() / "data" / "sessions"


@lru_cache
def get_settings() -> Settings:
    return Settings()

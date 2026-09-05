"""自定义 Agent 工厂：注册表配置 → DataAnalysisAgent 实例。

从 deps.py 拆出（组合根保持只做装配）；与内置 Agent 走同一条流水线，
仅语义工程（MDL）与目标库连接不同。
"""
from __future__ import annotations

import base64
import json
import tempfile
import threading
from pathlib import Path
from typing import Any

from langchain_openai import ChatOpenAI
from loguru import logger

from app.agents.data_analysis import DataAnalysisAgent
from app.agents.domain import DEFAULT_CUSTOM_SYSTEM_PROMPT, AgentDomainConfig
from app.config import Settings
from app.llm import build_llm


class WrenEnginePoolAdapter:
    """把多个 wren.engine.WrenEngine 适配为 WrenEngineService 的最小接口。

    与 WrenEngineService 相同的轮询池模式：每引擎一条独立 psycopg 连接（懒创建），
    均注入语句超时。流水线只依赖 fetch_context/fetch_instructions/dry_run/query。
    """

    def __init__(self, engines: list, row_limit: int = 500):
        self._engines = engines
        self._row_limit = row_limit
        self._rr_index = 0
        self._rr_lock = threading.Lock()

    def _pick_engine(self):
        with self._rr_lock:
            engine = self._engines[self._rr_index]
            self._rr_index = (self._rr_index + 1) % len(self._engines)
            return engine

    def fetch_context(self, question: str) -> str:
        # 自定义 Agent 无 WrenMemory 索引：语义上下文靠工程本身的 MDL 表结构
        return ""

    def fetch_instructions(self) -> str:
        return ""

    def dry_run(self, sql: str) -> tuple[bool, str | None]:
        try:
            self._pick_engine().dry_run(sql)
            return (True, None)
        except Exception as e:
            return (False, str(e))

    def query(self, sql: str) -> list[dict]:
        from app.semantic.wren_engine import rows_json_ready

        table = self._pick_engine().query(sql, limit=self._row_limit)
        return rows_json_ready(table.to_pylist())

    @property
    def row_limit(self) -> int:
        return self._row_limit

    def close(self):
        for engine in self._engines:
            if hasattr(engine, "close"):
                try:
                    engine.close()
                except Exception:
                    pass


def build_custom_agent(config: dict, settings: Settings, memory: Any) -> DataAnalysisAgent:
    """注册表记录 → 独立 WrenEngine 池 + LLM + DataAnalysisAgent。

    config 键：agentId/name/label/description/systemPrompt/projectJson/db{host,port,...}
    """
    from wren.config import WrenConfig
    from wren.engine import WrenEngine

    project_json = config["projectJson"]
    proj = json.loads(project_json)
    # 落临时工程目录（调试/排障时可定位到实际使用的 MDL）
    tmp = Path(tempfile.mkdtemp(prefix=f"piwren-agent-{config['agentId']}-"))
    (tmp / "mdl.json").write_text(json.dumps(proj), encoding="utf-8")

    manifest_str = base64.b64encode(project_json.encode()).decode()
    conn_info = {
        "host": config["db"].get("host", "localhost"),
        "port": config["db"].get("port", 5432),
        "user": config["db"].get("user", ""),
        "password": config["db"].get("password", ""),
        "database": config["db"].get("database", ""),
        "kwargs": {
            "options": f"-c statement_timeout={settings.AI_QUERY_TIMEOUT_SECONDS}s",
        },
    }
    wren_config = WrenConfig(strict_mode=settings.WREN_STRICT_MODE)
    pool_size = max(1, settings.AI_ENGINE_POOL_SIZE)
    engines = [WrenEngine(manifest_str, "postgres", conn_info, config=wren_config)
               for _ in range(pool_size)]

    # 白名单 = 工程 models 的物理表 + 字典表（与内置 Agent 同规则）
    tables = [t for m in proj.get("models", []) for t in [((m.get("tableReference") or {}).get("table") or "").lower()] if t]
    tables.append("sys_dict")

    domain = AgentDomainConfig(
        id=config["agentId"], label=config["label"],
        description=config.get("description") or f"自定义数据查询 Agent（{config['name']}）",
        system_prompt=config.get("systemPrompt") or DEFAULT_CUSTOM_SYSTEM_PROMPT,
    )
    agent = DataAnalysisAgent(domain, WrenEnginePoolAdapter(
        engines, row_limit=settings.AI_QUERY_ROW_LIMIT,
    ), build_llm(settings), tables, memory=memory)
    logger.info("自定义 Agent 已构建: {}（引擎 x{}）", config["agentId"], pool_size)
    return agent

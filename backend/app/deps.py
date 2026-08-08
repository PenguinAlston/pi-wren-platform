"""依赖装配（对应 TS apps/api/src/deps.ts 的 buildDeps）。

启动时构建 WrenEngineService + DataAnalysisAgent + 连接池，存入 AppState 供路由复用。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from langchain_openai import ChatOpenAI
from loguru import logger

from app.agents.data_analysis import DataAnalysisAgent
from app.agents.domain import AgentDomainConfig, insurance_domain
from app.config import Settings
from app.models.schemas import AgentInfo
from app.semantic.mdl_loader import load_allowed_tables
from app.semantic.wren_engine import WrenEngineService

DEFAULT_CUSTOM_SYSTEM_PROMPT = (
    "你是一名严谨的企业数据查询分析师。基于给定的查询结果，用提问相同的语言给出简洁的执行摘要："
    "先说明总体结论，再列出关键数据点与变化，最后给出 1-2 条建议。"
    "必须严格依据查询结果作答，禁止编造、推测或补全数据中不存在的字段与数值。"
    "所有日期、金额、数量必须与查询结果逐字一致，禁止改写、取整或推算。"
    "数据中不包含的信息必须明确说明“数据中未包含”，不得臆测。"
)


class _WrenEngineAdapter:
    """把 wren.engine.WrenEngine 适配为 WrenEngineService 的最小接口（自定义 Agent 用）。"""

    def __init__(self, engine, manifest_str: str):
        self._engine = engine
        self._manifest_str = manifest_str

    def fetch_context(self, question: str) -> str:
        return ""

    def fetch_instructions(self) -> str:
        return ""

    def dry_plan(self, sql: str) -> str:
        return str(self._engine.dry_plan(sql))

    def dry_run(self, sql: str) -> tuple[bool, str | None]:
        try:
            self._engine.dry_run(sql)
            return (True, None)
        except Exception as e:
            return (False, str(e))

    def query(self, sql: str) -> list[dict]:
        from app.semantic.wren_engine import rows_json_ready

        table = self._engine.query(sql)
        return rows_json_ready(table.to_pylist())

    def close(self):
        if hasattr(self._engine, "close"):
            self._engine.close()


@dataclass
class AgentSpec:
    """一个可对外服务的 Agent 实例（内置或自定义）。"""

    id: str
    label: str
    description: str
    agent: DataAnalysisAgent
    source: str = "builtin"  # builtin | custom
    metrics: list[dict[str, Any]] = field(default_factory=list)

    def to_info(self) -> AgentInfo:
        return AgentInfo(id=self.id, label=self.label, description=self.description,
                         metrics=self.metrics, source=self.source)


@dataclass
class AppState:
    """应用全局状态：启动时构建一次，路由通过 Depends 获取。"""

    settings: Settings
    agents: dict[str, AgentSpec]  # agent_id → spec
    engine: WrenEngineService
    pool: Any  # asyncpg.Pool（传统查询用，阶段 5 接入）
    memory: Any = None  # JsonlSessionStore
    agent_store: Any = None  # AgentConfigStore（自定义 Agent 持久化）
    agent_registry: Any = None  # AgentRegistry（自定义 Agent 生命周期）
    audit: Any = None  # OperationAuditLogger
    insurance: Any = None  # InsuranceQueryService（传统查询）

    def get_agent(self, domain: str) -> AgentSpec | None:
        return self.agents.get(domain)


def build_llm(settings: Settings) -> ChatOpenAI:
    """从配置构建 LLM（支持 OpenAI 兼容 / DashScope GLM）。"""
    return ChatOpenAI(
        model=settings.OPENAI_MODEL or "gpt-4o-mini",
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
        temperature=0,
        max_tokens=800,
        timeout=100,
    )


async def build_state(settings: Settings) -> AppState:
    """启动时构建应用状态：WrenEngine + 内置 Agent + 连接池。"""
    logger.info("正在初始化依赖...")

    engine = WrenEngineService(settings)
    allowed_tables = load_allowed_tables(settings.wren_project_path / "target" / "mdl.json")
    logger.info("白名单表: {}", allowed_tables)

    llm = build_llm(settings)

    # 会话存储（jsonl）
    from app.session.jsonl_store import JsonlSessionStore

    memory = JsonlSessionStore(settings.sessions_root)
    logger.info("会话存储: {}", memory.root)

    # 内置 Agent（当前仅保险）
    agents: dict[str, AgentSpec] = {}
    for domain in [insurance_domain]:
        agent = DataAnalysisAgent(domain, engine, llm, allowed_tables, memory=memory)
        spec = AgentSpec(
            id=domain.id, label=domain.label, description=domain.description,
            agent=agent, source="builtin",
        )
        agents[domain.id] = spec
        logger.info("已注册内置 Agent: {} ({})", domain.id, domain.label)

    # 传统查询连接池（只读）
    from app.data.db import create_default_pool, create_writable_pool

    pool = await create_default_pool(settings)
    # 传统保险查询服务
    from app.insurance.service import InsuranceQueryService

    insurance = InsuranceQueryService(pool)
    # 可写连接池（自定义 Agent 注册表/审计写入用）
    writable_pool = await create_writable_pool(settings)

    # 审计（写入 sys_operation_log，失败不阻断）
    from app.registry.audit import OperationAuditLogger

    audit = OperationAuditLogger(writable_pool, settings.AUDIT_USER_ID)

    # 自定义 Agent 注册表（配置 AGENT_SECRET_KEY 时启用）
    agent_store = None
    agent_registry = None
    if settings.AGENT_SECRET_KEY:
        from app.registry.agent_registry import AgentRegistry
        from app.registry.store import AgentConfigStore

        agent_store = AgentConfigStore(writable_pool)

        async def _custom_factory(config: dict):
            """自定义 Agent 工厂：project JSON → 临时工程目录 → WrenEngine → DataAnalysisAgent。"""
            import tempfile
            from pathlib import Path

            from langchain_openai import ChatOpenAI
            from app.agents.data_analysis import DataAnalysisAgent
            from app.agents.domain import AgentDomainConfig

            project_json = config["projectJson"]
            proj = json.loads(project_json)
            tmp = Path(tempfile.mkdtemp(prefix=f"piwren-agent-{config['agentId']}-"))
            (tmp / "mdl.json").write_text(json.dumps(proj), encoding="utf-8")

            # 自定义 Agent 用独立 WrenEngine（MDL 来自其工程）
            import base64
            from wren.engine import WrenEngine

            manifest_str = base64.b64encode(project_json.encode()).decode()
            engine_instance = WrenEngine(manifest_str, "postgres", {
                "host": config["db"].get("host", "localhost"),
                "port": config["db"].get("port", 5432),
                "user": config["db"].get("user", ""),
                "password": config["db"].get("password", ""),
                "database": config["db"].get("database", ""),
            })
            from app.semantic.wren_engine import WrenEngineService

            # 复用 DataAnalysisAgent，但用自定义的 engine
            agent_llm = ChatOpenAI(
                model=settings.OPENAI_MODEL or "gpt-4o-mini",
                api_key=settings.OPENAI_API_KEY,
                base_url=settings.OPENAI_BASE_URL,
                temperature=0, max_tokens=800, timeout=100,
            )
            tables = [t for m in proj.get("models", []) for t in [((m.get("tableReference") or {}).get("table") or "").lower()] if t]
            tables.append("sys_dict")
            domain = AgentDomainConfig(
                id=config["agentId"], label=config["label"],
                description=config.get("description") or f"自定义数据查询 Agent（{config['name']}）",
                system_prompt=config.get("systemPrompt") or DEFAULT_CUSTOM_SYSTEM_PROMPT,
            )
            agent = DataAnalysisAgent(domain, _WrenEngineAdapter(engine_instance, manifest_str), agent_llm, tables, memory=memory)
            return agent

        registry = AgentRegistry(agent_store, settings.AGENT_SECRET_KEY, _custom_factory)
        load = await registry.load_all()
        if load["failed"]:
            logger.warning("自定义 Agent 加载失败: {}", load["failed"])
        agent_registry = registry
        # 自定义 Agent 加入 agents 列表
        for agent_id in registry._instances:
            inst = registry._instances[agent_id]
            agents[agent_id] = AgentSpec(id=agent_id, label=inst.domain.label,
                                         description=inst.domain.description, agent=inst, source="custom")
        logger.info("自定义 Agent 已启用: {}", list(registry._instances.keys()))

    logger.info("依赖初始化完成: agents={}", list(agents.keys()))
    return AppState(settings=settings, agents=agents, engine=engine, pool=pool,
                    memory=memory, agent_store=agent_store, agent_registry=agent_registry, audit=audit,
                    insurance=insurance)

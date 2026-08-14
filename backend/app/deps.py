"""依赖装配（组合根）：启动时构建 WrenEngineService + Agent 集 + 连接池 + 各服务，存入 AppState。

只做装配——自定义 Agent 的构建逻辑在 registry/factory.py，LLM 构建在 llm.py。
"""
from __future__ import annotations

import asyncpg
from dataclasses import dataclass, field
from loguru import logger

from app.agents.data_analysis import DataAnalysisAgent
from app.agents.domain import AgentDomainConfig, insurance_domain
from app.auth.store import UserStore
from app.config import Settings
from app.insurance.service import InsuranceQueryService
from app.llm import build_llm
from app.models.schemas import AgentInfo
from app.ratelimit import SlidingWindowRateLimiter
from app.registry.agent_registry import AgentRegistry
from app.registry.audit import OperationAuditLogger
from app.registry.store import AgentConfigStore
from app.semantic.mdl_loader import load_allowed_tables
from app.semantic.wren_engine import WrenEngineService
from app.session.db_store import DbSessionStore


@dataclass
class AgentSpec:
    """一个可对外服务的 Agent 实例（内置或自定义）。"""

    id: str
    label: str
    description: str
    agent: DataAnalysisAgent
    source: str = "builtin"  # builtin | custom
    metrics: list[dict] = field(default_factory=list)

    def to_info(self) -> AgentInfo:
        return AgentInfo(id=self.id, label=self.label, description=self.description,
                         metrics=self.metrics, source=self.source)


@dataclass
class AppState:
    """应用全局状态：启动时构建一次，路由通过 request.app.state.app_state 获取。"""

    settings: Settings
    agents: dict[str, AgentSpec]  # agent_id → spec
    engine: WrenEngineService
    pool: asyncpg.Pool  # 传统查询只读池
    memory: DbSessionStore
    audit: OperationAuditLogger
    insurance: InsuranceQueryService
    users: UserStore | None = None  # AUTH_ENABLED 时非空
    agent_store: AgentConfigStore | None = None  # 自定义 Agent 持久化
    agent_registry: AgentRegistry | None = None  # 自定义 Agent 生命周期
    rate_limit_chat: SlidingWindowRateLimiter | None = None
    rate_limit_login: SlidingWindowRateLimiter | None = None

    def get_agent(self, domain: str) -> AgentSpec | None:
        return self.agents.get(domain)


async def build_state(settings: Settings) -> AppState:
    """启动时构建应用状态：WrenEngine + 内置 Agent + 连接池 + 认证/限流。"""
    logger.info("正在初始化依赖...")

    engine = WrenEngineService(settings)
    allowed_tables = load_allowed_tables(settings.wren_project_path / "target" / "mdl.json")
    logger.info("白名单表: {}", allowed_tables)

    # 传统查询连接池（只读）+ 可写池（会话/注册表/审计）
    from app.data.db import create_default_pool, create_writable_pool

    pool = await create_default_pool(settings)
    insurance = InsuranceQueryService(pool)
    writable_pool = await create_writable_pool(settings)

    memory = DbSessionStore(writable_pool)
    audit = OperationAuditLogger(writable_pool, settings.AUDIT_USER_ID)

    # 内置 Agent（当前仅保险）
    agents: dict[str, AgentSpec] = {}
    for domain in [insurance_domain]:
        agent = DataAnalysisAgent(domain, engine, build_llm(settings), allowed_tables, memory=memory)
        agents[domain.id] = AgentSpec(
            id=domain.id, label=domain.label, description=domain.description,
            agent=agent, source="builtin",
        )
        logger.info("已注册内置 Agent: {} ({})", domain.id, domain.label)

    # 自定义 Agent 注册表（配置 AGENT_SECRET_KEY 时启用）
    agent_store = None
    agent_registry = None
    if settings.AGENT_SECRET_KEY:
        from app.registry.factory import build_custom_agent

        agent_store = AgentConfigStore(writable_pool)
        registry = AgentRegistry(agent_store, settings.AGENT_SECRET_KEY,
                                 lambda config: build_custom_agent(config, settings, memory))
        load = await registry.load_all()
        if load["failed"]:
            logger.warning("自定义 Agent 加载失败: {}", load["failed"])
        agent_registry = registry
        for agent_id in registry.instances:
            inst = registry.instances[agent_id]
            agents[agent_id] = AgentSpec(id=agent_id, label=inst.domain.label,
                                         description=inst.domain.description, agent=inst, source="custom")
        logger.info("自定义 Agent 已启用: {}", list(registry.instances.keys()))

    # 限流器（进程内存滑动窗口；0 = 关闭）
    rate_limit_chat = SlidingWindowRateLimiter(settings.RATE_LIMIT_CHAT_PER_MIN)
    rate_limit_login = SlidingWindowRateLimiter(settings.RATE_LIMIT_LOGIN_PER_MIN)

    # 用户认证（AUTH_ENABLED 时启用：建表 + 引导管理员）
    users = None
    if settings.AUTH_ENABLED:
        users = UserStore(writable_pool)
        await users.ensure_table()
        await users.bootstrap_admin(
            username=settings.AUTH_ADMIN_USERNAME, password=settings.AUTH_ADMIN_PASSWORD,
        )
        logger.info("用户认证已启用: 会话有效期 {}h", settings.AUTH_SESSION_HOURS)
    else:
        logger.warning("AUTH_ENABLED=false：聊天/会话/传统查询接口未鉴权，禁止用于生产环境")

    logger.info("依赖初始化完成: agents={}", list(agents.keys()))
    return AppState(settings=settings, agents=agents, engine=engine, pool=pool,
                    memory=memory, agent_store=agent_store, agent_registry=agent_registry,
                    audit=audit, insurance=insurance, users=users,
                    rate_limit_chat=rate_limit_chat, rate_limit_login=rate_limit_login)

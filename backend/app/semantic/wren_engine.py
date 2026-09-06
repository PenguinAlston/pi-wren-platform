"""WrenAI 语义引擎封装（进程内调用，替代 TS 版的 WrenCli 子进程 + WrenCliContextEngine）。

WrenEngine 做 MDL→物理 SQL 翻译 + 查询；WrenMemory 做语义检索。
全程进程内调用，无 execFile 子进程、无 MCP HTTP。
"""
from __future__ import annotations

import base64
import json
import threading
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from loguru import logger

from app.config import Settings


def json_ready(value: Any) -> Any:
    """asyncpg/pyarrow 返回值转 JSON 友好类型（Decimal → float，日期 → iso）。"""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def rows_json_ready(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: json_ready(v) for k, v in row.items()} for row in rows]


class WrenEngineService:
    """封装 WrenEngine + WrenMemory，提供语义检索 + SQL 校验 + 受治理执行。

    初始化时加载 MDL（target/mdl.json），构建 WrenEngine 引擎池和 WrenMemory 实例。
    每个 WrenEngine 持有一条独立的 psycopg 连接（懒创建），调用经轮询分发，
    避免高并发下所有 AI 查询在单连接上串行排队。WrenMemory 只读，单实例共享。
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        project_dir = settings.wren_project_path
        self._project_dir = project_dir
        self._mdl_path = project_dir / "target" / "mdl.json"

        if not self._mdl_path.exists():
            raise RuntimeError(
                f"MDL 未构建：{self._mdl_path} 不存在。请先在 {project_dir} 执行 `wren context build`"
            )

        with open(self._mdl_path, encoding="utf-8") as f:
            mdl_text = f.read()
        self._manifest_str = base64.b64encode(mdl_text.encode()).decode()
        self._manifest_dict: dict[str, Any] = json.loads(mdl_text)

        self._connection_info = {
            "host": settings.DB_HOST,
            "port": settings.DB_PORT,
            "user": settings.DB_USER,
            "password": settings.DB_PASSWORD,
            "database": settings.DB_NAME,
            # libpq options：覆盖 wren 连接器默认的 180s，约束单条 AI 查询时长
            "kwargs": {
                "options": f"-c statement_timeout={settings.AI_QUERY_TIMEOUT_SECONDS}s",
            },
        }
        self._row_limit = settings.AI_QUERY_ROW_LIMIT
        self._pool_size = max(1, settings.AI_ENGINE_POOL_SIZE)

        # 延迟导入（wrenai 重，避免 import 时副作用）
        from wren.config import WrenConfig
        from wren.engine import WrenEngine

        self._engine_cls = WrenEngine
        # strict mode：fail-closed 治理（表白名单 + 数据外读函数拦截），翻译层兜底之上的显式闸
        extra_denied = frozenset(
            f.strip().lower() for f in (settings.WREN_DENIED_FUNCTIONS or "").split(",") if f.strip()
        )
        self._wren_config = WrenConfig(strict_mode=settings.WREN_STRICT_MODE,
                                       denied_functions=extra_denied)
        self._engines: list = [self._build_engine() for _ in range(self._pool_size)]
        self._rr_index = 0
        self._rr_lock = threading.Lock()
        # 语义检索三级优先：远程 embedding API（零本地模型内存）→ 本地 WrenMemory
        # （embedding 模型约 1GB 内存，dev 用）→ MDL 直读（fetch_context 内降级）
        self._retriever = None
        if settings.WREN_EMBEDDING_API_KEY and settings.WREN_EMBEDDING_API_BASE:
            from app.semantic.embedding_retriever import EmbeddingRetriever

            self._retriever = EmbeddingRetriever(
                project_dir, self._manifest_dict,
                api_base=settings.WREN_EMBEDDING_API_BASE,
                api_key=settings.WREN_EMBEDDING_API_KEY,
                model=settings.WREN_EMBEDDING_MODEL,
            )
            self._memory = None
        else:
            if settings.WREN_MEMORY_ENABLED:
                from wren.memory import WrenMemory

                self._memory: WrenMemory | None = WrenMemory(str(project_dir))
            else:
                self._memory = None
        mode = "remote-embedding" if self._retriever else ("local-memory" if self._memory else "mdl-direct")
        logger.info("WrenEngineService 初始化完成: {}（引擎池 x{}，检索={}）",
                    project_dir, self._pool_size, mode)

    def _build_engine(self):
        return self._engine_cls(self._manifest_str, "postgres", self._connection_info,
                                config=self._wren_config)

    def _pick_engine(self):
        """轮询取引擎（线程安全；asyncio.to_thread 并发调用时分散到不同连接）。"""
        with self._rr_lock:
            engine = self._engines[self._rr_index]
            self._rr_index = (self._rr_index + 1) % len(self._engines)
            return engine

    # --- 语义检索 ---
    def fetch_context(self, question: str) -> str:
        """检索与问题相关的语义上下文（表/列/相似查询）。

        降级链：远程 embedding 检索 / 本地 WrenMemory → MDL 直读 schema 摘要 → instructions。
        """
        if self._retriever is not None:
            try:
                context = self._retriever.search(question)
                return context.strip() or self._mdl_light_context()
            except Exception as e:
                logger.warning("远程 embedding 检索失败，降级为 MDL 直读: {}", e)
                return self._mdl_light_context()
        if self._memory is not None:
            try:
                result = self._memory.get_context(manifest=self._manifest_dict, query=question)
                schema_text = result.get("schema", "") if isinstance(result, dict) else str(result)
                return schema_text.strip() or self._mdl_light_context()
            except Exception as e:
                logger.warning("get_context 失败，降级为 MDL 直读: {}", e)
                return self._mdl_light_context()
        return self._mdl_light_context()

    def _mdl_light_context(self) -> str:
        """无向量检索的轻量语义上下文：MDL 里的表/列/描述，纯 JSON 解析零 ML。"""
        lines: list[str] = []
        for model in self._manifest_dict.get("models", []):
            name = model.get("name", "")
            desc = (model.get("description") or "").strip()
            columns = model.get("columns", [])
            col_text = ", ".join(
                f"{c.get('name')}({c.get('type', '')})"
                for c in columns[:40] if c.get("name")
            )
            lines.append(f"- {name}" + (f"：{desc}" if desc else "") + f"\n  列: {col_text}")
        return "\n".join(lines)

    def fetch_instructions(self) -> str:
        """业务规则全文（knowledge/rules/）。"""
        try:
            from wren.context import Context

            ctx = Context(self._project_dir)
            return ctx.instructions().strip()
        except Exception:
            # 降级：直接读 rules markdown
            rules_path = self._project_dir / "knowledge" / "rules"
            if rules_path.exists():
                parts: list[str] = []
                for md in sorted(rules_path.glob("*.md")):
                    parts.append(md.read_text(encoding="utf-8"))
                return "\n\n".join(parts).strip()
            return ""

    # --- SQL 校验 + 执行 ---
    def dry_run(self, sql: str) -> tuple[bool, str | None]:
        """校验 SQL（解析 + 合法 + 仅 MDL 内表）。返回 (ok, error)。"""
        try:
            self._pick_engine().dry_run(sql)
            return (True, None)
        except Exception as e:
            return (False, str(e))

    def query(self, sql: str) -> list[dict[str, Any]]:
        """经 Wren 引擎翻译后执行 SQL，返回 JSON 友好的行列表。

        行数超过 row_limit 时由引擎在外层包 LIMIT 截断（防全表拉取打爆内存）。
        """
        table = self._pick_engine().query(sql, limit=self._row_limit)
        return rows_json_ready(table.to_pylist())

    @property
    def row_limit(self) -> int:
        return self._row_limit

    @property
    def pool_size(self) -> int:
        return len(self._engines)

    def close(self):
        for engine in self._engines:
            if hasattr(engine, "close"):
                try:
                    engine.close()
                except Exception:
                    pass

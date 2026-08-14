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
        from wren.memory import WrenMemory

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
        self._memory = WrenMemory(str(project_dir))
        logger.info("WrenEngineService 初始化完成: {}（引擎池 x{}）", project_dir, self._pool_size)

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
        """检索与问题相关的语义上下文（表/列/相似查询）。"""
        try:
            result = self._memory.get_context(manifest=self._manifest_dict, query=question)
            schema_text = result.get("schema", "") if isinstance(result, dict) else str(result)
            return schema_text.strip()
        except Exception as e:
            logger.warning("get_context 失败，降级为 instructions: {}", e)
            return self.fetch_instructions()

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

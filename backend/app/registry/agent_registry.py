"""自定义 Agent 注册表（对应 TS services/agent-registry/src/registry.ts）。

生命周期：加载/注册/更新/停用/注销，单 Agent 失败隔离，连接串 AES 加密。
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Callable

from loguru import logger

from app.registry.crypto import decrypt_secret, encrypt_secret
from app.registry.store import AgentConfigStore


class AgentRegistry:
    """管理自定义 Agent 配置 + 运行实例。"""

    def __init__(
        self,
        store: AgentConfigStore,
        secret_key: str,
        factory: Callable[[dict[str, Any]], Any],
        on_dispose: Callable[[str], None] | None = None,
    ):
        self._store = store
        self._secret_key = secret_key
        self._factory = factory
        self._on_dispose = on_dispose
        self._instances: dict[str, Any] = {}

    # --- 生命周期 ---
    async def load_all(self) -> dict:
        """启动时加载全部 enabled 配置；单个失败仅记录，不影响其他。"""
        failed: list[dict] = []
        loaded = 0
        for record in await self._store.list():
            if record["status"] != "enabled":
                continue
            try:
                config = self._record_to_config(record)
                instance = await self._build(config)
                self._instances[record["agentId"]] = instance
                loaded += 1
            except Exception as e:
                failed.append({"agentId": record["agentId"], "error": str(e)})
                await self._store.update(record["agentId"], {"status": "error", "lastError": str(e)})
                logger.warning("自定义 Agent 加载失败: {}: {}", record["agentId"], e)
        return {"loaded": loaded, "failed": failed}

    async def register(self, config: dict[str, Any]) -> Any:
        """注册：先构建成功再落库。"""
        config = {**config, "dbConnectionEnc": encrypt_secret(json.dumps(config["db"]), self._secret_key)}
        # 构建验证（失败抛错，不落库）
        record = {
            "agentId": config["agentId"], "name": config["name"], "label": config["label"],
            "description": config.get("description"), "systemPrompt": config.get("systemPrompt"),
            "projectJson": config["projectJson"], "dbConnectionEnc": config["dbConnectionEnc"],
            "status": "enabled", "lastError": None, "ownerId": config.get("ownerId"),
        }
        # 用解密后的 config 构建（build 需要明文 db）
        build_config = {**config, "db": config["db"]}
        instance = await self._build(build_config)
        saved = await self._store.create(record)
        self._instances[config["agentId"]] = instance
        return saved

    async def update(self, agent_id: str, patch: dict[str, Any]) -> Any | None:
        """更新：有配置变更且目标 enabled 时先构建成功再替换。"""
        current = await self._store.find_by_agent_id(agent_id)
        if not current:
            return None
        merged = {**self._record_to_config(current), **patch}
        has_config_change = any(k in patch for k in
                                ["projectJson", "name", "label", "description", "systemPrompt"])

        if merged["status"] == "disabled" or not has_config_change:
            db_enc = encrypt_secret(json.dumps(merged["db"]), self._secret_key) if "db" in patch else current["dbConnectionEnc"]
            await self._store.update(agent_id, {
                **(patch or {}),
                **({"dbConnectionEnc": db_enc} if "db" in patch else {}),
                "lastError": None,
            })
            if merged["status"] == "disabled":
                self._instances.pop(agent_id, None)
                if self._on_dispose:
                    self._on_dispose(agent_id)
            return self._instances.get(agent_id) or current

        # 有配置变更 → 先构建
        instance = await self._build(merged)
        db_enc = encrypt_secret(json.dumps(merged["db"]), self._secret_key)
        saved = await self._store.update(agent_id, {
            "name": merged["name"], "label": merged["label"],
            "description": merged.get("description"), "systemPrompt": merged.get("systemPrompt"),
            "projectJson": merged["projectJson"], "dbConnectionEnc": db_enc,
            "status": "enabled", "lastError": None,
            "ownerId": merged.get("ownerId"),
        })
        previous = self._instances.get(agent_id)
        self._instances[agent_id] = instance
        if previous is not None and self._on_dispose:
            self._on_dispose(agent_id)
        return saved

    async def delete(self, agent_id: str) -> bool:
        ok = await self._store.delete(agent_id)
        if ok:
            self._instances.pop(agent_id, None)
            if self._on_dispose:
                self._on_dispose(agent_id)
        return ok

    def get(self, agent_id: str) -> Any | None:
        return self._instances.get(agent_id)

    def list(self) -> list[Any]:
        return list(self._instances.values())

    # --- 内部 ---
    async def _build(self, config: dict[str, Any]):
        """调用注入的工厂构建实例。"""
        return await self._factory(config)

    def _record_to_config(self, record: dict[str, Any]) -> dict[str, Any]:
        return {
            "agentId": record["agentId"],
            "name": record["name"],
            "label": record["label"],
            "description": record.get("description"),
            "systemPrompt": record.get("systemPrompt"),
            "projectJson": record["projectJson"],
            "db": json.loads(decrypt_secret(record["dbConnectionEnc"], self._secret_key)),
            "status": record["status"],
            "ownerId": record.get("ownerId"),
        }

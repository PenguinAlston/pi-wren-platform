"""Agent 列表路由（对应 TS routes/agents.ts）。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.deps import AppState

router = APIRouter()


@router.get("/api/agents")
async def list_agents(request: Request):
    state: AppState = request.app.state.app_state
    # 合并内置 Agent（state.agents）与自定义 Agent（agent_store 持久层）。
    # 自定义 Agent 可能是在服务启动后通过管理页注册的，未进 state.agents 快照，
    # 故从 agent_store 实时读取；仅暴露 enabled 的，source 标记为 custom。按 id 去重。
    by_id: dict[str, Any] = {spec.id: spec.to_info().model_dump() for spec in state.agents.values()}
    if state.agent_store is not None:
        for rec in await state.agent_store.list():
            if rec.get("status") != "enabled":
                continue
            by_id[rec["agentId"]] = {
                "id": rec["agentId"],
                "label": rec.get("label") or rec.get("name") or rec["agentId"],
                "description": rec.get("description") or "",
                "metrics": [],
                "source": "custom",
            }
    return JSONResponse(content={"agents": list(by_id.values())})

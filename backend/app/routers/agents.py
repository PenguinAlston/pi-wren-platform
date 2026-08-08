"""Agent 列表路由（对应 TS routes/agents.ts）。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.deps import AppState

router = APIRouter()


@router.get("/api/agents")
async def list_agents(request: Request):
    state: AppState = request.app.state.app_state
    agents = [spec.to_info().model_dump() for spec in state.agents.values()]
    return JSONResponse(content={"agents": agents})

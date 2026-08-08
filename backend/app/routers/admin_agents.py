"""自定义 Agent 管理路由（对应 TS routes/admin-agents.ts）。

X-Admin-Token 鉴权 + 工程 JSON 校验 + 注册/启停/编辑/删除 + 连接测试 + 状态监控。
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.registry.crypto import decrypt_secret

router = APIRouter()

_AGENT_ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")


def _require_admin(request: Request) -> bool:
    """X-Admin-Token 与环境 ADMIN_TOKEN 比对。"""
    token = request.app.state.app_state.settings.ADMIN_TOKEN
    if not token:
        return False
    return request.headers.get("x-admin-token") == token


def _admin_error(resp: JSONResponse) -> JSONResponse:
    return resp


def _db_schema(body: dict) -> dict:
    return {
        "host": body.get("host", "localhost"),
        "port": body.get("port", 5432),
        "database": body.get("database", ""),
        "user": body.get("user", ""),
        "password": body.get("password", ""),
        "max": body.get("max"),
    }


def _mask_connection(db: dict) -> str:
    host = db.get("host", "localhost")
    port = db.get("port", 5432)
    database = db.get("database", "")
    return f"***@{host}:{port}/{database}"


def _to_public_view(record: dict, include_project: bool = False) -> dict:
    db = json.loads(decrypt_secret(record["dbConnectionEnc"], record["_secret"])) if record.get("_secret") else {}
    view = {
        "id": record["id"],
        "agentId": record["agentId"],
        "name": record["name"],
        "label": record["label"],
        "description": record.get("description"),
        "systemPrompt": record.get("systemPrompt"),
        "project": record.get("projectJson") if include_project else None,
        "connection": _mask_connection(db),
        "status": record["status"],
        "lastError": record.get("lastError"),
        "createdAt": record.get("createdAt"),
        "updatedAt": record.get("updatedAt"),
    }
    return view


@router.get("/api/admin/agents")
async def list_admin_agents(request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    state = request.app.state.app_state
    owner_id = request.query_params.get("ownerId")
    records = await state.agent_store.list()
    if owner_id:
        records = [r for r in records if r.get("ownerId") == owner_id]
    views = [_to_public_view({**r, "_secret": state.settings.AGENT_SECRET_KEY}) for r in records]
    return JSONResponse(content={"agents": views})


@router.get("/api/admin/agents/{agent_id}")
async def get_admin_agent(agent_id: str, request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    state = request.app.state.app_state
    record = await state.agent_store.find_by_agent_id(agent_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})
    view = _to_public_view({**record, "_secret": state.settings.AGENT_SECRET_KEY}, include_project=True)
    return JSONResponse(content={"agent": view})


@router.post("/api/admin/agents")
async def create_admin_agent(request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    state = request.app.state.app_state
    body = await request.json()

    agent_id = (body.get("agentId") or "").strip()
    if not _AGENT_ID_RE.match(agent_id):
        return JSONResponse(status_code=400, content={"error": "agentId 只允许小写字母/数字/连字符"})
    name = (body.get("name") or "").strip()
    label = (body.get("label") or "").strip()
    project = (body.get("project") or "").strip()
    if not name or not label or not project:
        return JSONResponse(status_code=400, content={"error": "name/label/project 必填"})
    # 校验工程 JSON
    try:
        proj = json.loads(project)
        if not isinstance(proj.get("models"), list) or not proj["models"]:
            return JSONResponse(status_code=400, content={"error": "工程 JSON 必须包含非空 models 数组"})
    except json.JSONDecodeError:
        return JSONResponse(status_code=400, content={"error": "project 不是合法 JSON"})

    db = _db_schema(body)
    config = {
        "agentId": agent_id, "name": name, "label": label,
        "description": body.get("description"), "systemPrompt": body.get("systemPrompt"),
        "projectJson": project, "db": db, "ownerId": body.get("ownerId"),
    }
    try:
        saved = await state.agent_registry.register(config)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    if state.audit:
        await state.audit.log("agent_register", f"注册自定义 Agent：{agent_id}（{label}）",
                              sql_content=f"project={len(project)} chars", ip_address=request.client.host)
    return JSONResponse(status_code=201, content={"agent": {"id": saved["agentId"], "label": saved["label"], "source": "custom"}})


@router.put("/api/admin/agents/{agent_id}")
async def update_admin_agent(agent_id: str, request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    state = request.app.state.app_state
    body = await request.json()
    record = await state.agent_store.find_by_agent_id(agent_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})

    patch: dict = {}
    for key in ["name", "label", "description", "systemPrompt", "ownerId", "status"]:
        if key in body:
            patch[key] = body[key]
    if "project" in body:
        patch["projectJson"] = body["project"]
    if "db" in body:
        patch["db"] = _db_schema(body["db"] if isinstance(body["db"], dict) else body)

    try:
        await state.agent_registry.update(agent_id, patch)
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

    oper_type = "agent_status" if patch.get("status") and patch["status"] != record["status"] else "agent_update"
    if state.audit:
        await state.audit.log(oper_type, f"{'变更状态' if oper_type == 'agent_status' else '更新配置'}：{agent_id}（{record['name']}）",
                              ip_address=request.client.host)
    return JSONResponse(content={"agent": {"id": agent_id, "label": record["label"], "source": "custom"}})


@router.delete("/api/admin/agents/{agent_id}")
async def delete_admin_agent(agent_id: str, request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    state = request.app.state.app_state
    ok = await state.agent_registry.delete(agent_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})
    if state.audit:
        await state.audit.log("agent_delete", f"注销自定义 Agent：{agent_id}", ip_address=request.client.host)
    return JSONResponse(status_code=204, content=None)


@router.get("/api/admin/agents/{agent_id}/status")
async def agent_status(agent_id: str, request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    state = request.app.state.app_state
    record = await state.agent_store.find_by_agent_id(agent_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})
    active = state.agent_registry.get(agent_id) is not None
    return JSONResponse(content={
        "agentId": agent_id, "status": record["status"], "lastError": record.get("lastError"),
        "active": active, "pool": None,
    })


@router.post("/api/admin/agents/validate-project")
async def validate_project(request: Request):
    if not _require_admin(request):
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    body = await request.json()
    project = (body.get("project") or "").strip()
    try:
        proj = json.loads(project)
        models = proj.get("models")
        if not isinstance(models, list) or not models:
            raise ValueError("工程 JSON 必须包含非空 models 数组")
        names = [(m.get("tableReference") or {}).get("table") or m.get("name") or "(unnamed)" for m in models]
        return JSONResponse(content={"ok": True, "models": names})
    except Exception as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": f"WrenAI 工程校验失败：{e}"})

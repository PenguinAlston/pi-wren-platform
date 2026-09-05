"""自定义 Agent 管理路由（对应 TS routes/admin-agents.ts）。

X-Admin-Token 鉴权 + 工程 JSON 校验 + 注册/启停/编辑/删除 + 连接测试 + 状态监控。
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth.admin import require_admin
from app.registry.crypto import decrypt_secret
from app.semantic.db_introspect import generate_mdl_from_db

router = APIRouter()

_AGENT_ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")


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
    require_admin(request)
    state = request.app.state.app_state
    owner_id = request.query_params.get("ownerId")
    records = await state.agent_store.list()
    if owner_id:
        records = [r for r in records if r.get("ownerId") == owner_id]
    views = [_to_public_view({**r, "_secret": state.settings.AGENT_SECRET_KEY}) for r in records]
    return JSONResponse(content={"agents": views})


@router.get("/api/admin/agents/{agent_id}")
async def get_admin_agent(agent_id: str, request: Request):
    require_admin(request)
    state = request.app.state.app_state
    record = await state.agent_store.find_by_agent_id(agent_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})
    view = _to_public_view({**record, "_secret": state.settings.AGENT_SECRET_KEY}, include_project=True)
    return JSONResponse(content={"agent": view})


@router.post("/api/admin/agents")
async def create_admin_agent(request: Request):
    require_admin(request)
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
    require_admin(request)
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
    require_admin(request)
    state = request.app.state.app_state
    ok = await state.agent_registry.delete(agent_id)
    if not ok:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})
    if state.audit:
        await state.audit.log("agent_delete", f"注销自定义 Agent：{agent_id}", ip_address=request.client.host)
    return JSONResponse(status_code=204, content=None)


@router.get("/api/admin/agents/{agent_id}/status")
async def agent_status(agent_id: str, request: Request):
    require_admin(request)
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
    require_admin(request)
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


async def _probe_connection(db: dict) -> dict:
    """执行 SELECT 1 连通性测试，建临时只读连接池，结束即关。"""
    from app.data.db import create_pool
    pool = await create_pool(
        host=db.get("host", "localhost"),
        port=int(db.get("port", 5432)),
        database=db["database"],
        user=db["user"],
        password=db["password"],
        max_size=1,
    )
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": f"connection failed: {e}"}
    finally:
        await pool.close()


@router.post("/api/admin/agents/test")
async def test_db_connection(request: Request):
    """测试任意连接配置：POST /api/admin/agents/test。"""
    require_admin(request)
    body = await request.json()
    db_body = body.get("db") if isinstance(body.get("db"), dict) else body
    if not db_body.get("database") or not db_body.get("user") or not db_body.get("password"):
        return JSONResponse(status_code=400, content={"error": "invalid connection config"})
    result = await _probe_connection(_db_schema(db_body))
    return JSONResponse(status_code=200 if result["ok"] else 400, content=result)


@router.post("/api/admin/agents/{agent_id}/test")
async def test_agent_connection(agent_id: str, request: Request):
    """测试已注册 Agent 的连接：POST /api/admin/agents/{agent_id}/test。"""
    require_admin(request)
    state = request.app.state.app_state
    record = await state.agent_store.find_by_agent_id(agent_id)
    if not record:
        return JSONResponse(status_code=404, content={"error": f"agent not found: {agent_id}"})
    db = json.loads(decrypt_secret(record["dbConnectionEnc"], state.settings.AGENT_SECRET_KEY))
    result = await _probe_connection(db)
    return JSONResponse(status_code=200 if result["ok"] else 400, content=result)


@router.post("/api/admin/agents/import-from-db")
async def import_from_db(request: Request):
    """从数据库内省生成 WrenAI MDL JSON（不落库、不建实例）。

    与 validate-project 一样是"纯生成"——注册仍走 POST /api/admin/agents。
    用临时只读连接池执行内省，结束即关。
    """
    require_admin(request)
    state = request.app.state.app_state
    body = await request.json()
    db_body = body.get("db") if isinstance(body.get("db"), dict) else body
    db = _db_schema(db_body)
    if not db.get("database") or not db.get("user") or not db.get("password"):
        return JSONResponse(status_code=400, content={"error": "invalid request",
                                                      "details": "db.database/user/password 必填"})
    schema = (body.get("schema") or "public").strip() or "public"
    descriptions = body.get("descriptions")
    try:
        manifest = await generate_mdl_from_db(db, schema=schema, descriptions_text=descriptions)
        if not manifest["models"]:
            return JSONResponse(status_code=400, content={"error": f'schema "{schema}" 下未发现任何基础表'})
        if state.audit:
            await state.audit.log("agent_import",
                                  f"从数据库内省生成工程 JSON（schema={schema}, {len(manifest['models'])} 表）",
                                  sql_content=f'{db["host"]}:{db["port"]}/{db["database"]}',
                                  ip_address=request.client.host if request.client else None)
        return JSONResponse(content={
            "project": json.dumps(manifest, ensure_ascii=False, indent=2),
            "tables": [m["name"] for m in manifest["models"]],
        })
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"数据库内省失败：{e}"})

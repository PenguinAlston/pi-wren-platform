"""内部接口：供 Pi orchestrator 调用（internal token 鉴权，非公网）。

权限不从请求头取——按 x-user-id 反查本地用户表构造 OrgAccess，头部只传身份不传权限。
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth.org_access import OrgAccess
from app.deps import AppState

router = APIRouter(prefix="/internal")


def _check_internal_token(request: Request, settings) -> JSONResponse | None:
    """internal token 常量时间比较；未配置 = 拒绝一切（fail-closed）。"""
    expected = settings.INTERNAL_API_TOKEN or ""
    provided = request.headers.get("x-internal-token", "")
    if not expected or not provided or not secrets.compare_digest(provided, expected):
        return JSONResponse(status_code=401, content={"error": "invalid internal token"})
    return None


async def _resolve_access(request: Request, state: AppState) -> tuple[OrgAccess | None, str | None, JSONResponse | None]:
    """身份反查：AUTH_ENABLED 时按 user_id 查用户（存储自带缓存）构造三态权限。"""
    user_id = request.headers.get("x-user-id")
    if not state.settings.AUTH_ENABLED:
        return OrgAccess.unrestricted(), user_id, None
    user = await state.users.find_by_user_id(user_id) if (user_id and state.users) else None
    if user is None or user.status != "active":
        return None, user_id, JSONResponse(status_code=401, content={"error": "unknown or inactive user"})
    return OrgAccess.for_user(user), user_id, None


@router.post("/agent/{domain}/chat")
async def internal_agent_chat(domain: str, request: Request):
    state: AppState = request.app.state.app_state
    token_error = _check_internal_token(request, state.settings)
    if token_error:
        return token_error

    access, user_id, access_error = await _resolve_access(request, state)
    if access_error:
        return access_error

    spec = state.get_agent(domain)
    if not spec:
        return JSONResponse(status_code=404, content={"error": f"unknown agent: {domain}"})

    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message or len(message) > 4000:
        return JSONResponse(status_code=400, content={"error": "message is required (1-4000 chars)"})
    session_id = body.get("sessionId") or None

    # persist=True：回答落库拿到 messageId（Pi 模式反馈按钮可用）；会话 id 与 Pi 侧 JSONL 一致，
    # 经典问数会话列表也能看到同一会话（统一历史）
    result = await spec.agent.answer(
        message, session_id=session_id, user_id=user_id, org_access=access, persist=True,
    )
    return JSONResponse(content=result.model_dump())


_MODULE_METHODS = {
    "contract": "query_contract",
    "preserve": "query_preserve",
    "claim": "query_claim",
}


@router.post("/traditional/query")
async def internal_traditional_query(module: str, request: Request):
    """Pi traditional_query 工具后端：结构化列表查询（不走 NL2SQL）。"""
    state: AppState = request.app.state.app_state
    token_error = _check_internal_token(request, state.settings)
    if token_error:
        return token_error

    access, _user_id, access_error = await _resolve_access(request, state)
    if access_error:
        return access_error

    method_name = _MODULE_METHODS.get(module)
    if not method_name:
        return JSONResponse(status_code=400, content={
            "error": f"unknown module: {module}（可选 contract/preserve/claim）"})

    body = await request.json()
    cond = body.get("conditions") or {}
    if not isinstance(cond, dict):
        return JSONResponse(status_code=400, content={"error": "conditions must be an object"})
    try:
        page = max(1, int(body.get("page", 1)))
        page_size = min(100, max(1, int(body.get("pageSize", 10))))
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "page/pageSize must be integers"})
    sort_by = body.get("sortBy") or None
    sort_order = body.get("sortOrder") or None

    # org 模式覆盖 orgCode（防伪造），deny 直接拒绝——与 /api/traditional 同源逻辑
    if access.mode == "deny":
        return JSONResponse(status_code=403, content={
            "error": "当前账号未分配机构，无法查询业务数据，请联系管理员分配"})
    if access.mode == "org":
        cond = {**cond, "orgCode": access.org_code}

    service = state.insurance
    result = await getattr(service, method_name)(cond, page, page_size, sort_by, sort_order)
    return JSONResponse(content=result)


@router.get("/graph/overview")
async def internal_graph_overview(request: Request):
    """Pi graph_query 工具后端：全图概览统计（org 模式做 BFS 子图过滤，同 /api/graph）。"""
    return await _graph_proxy(request, None)


@router.get("/graph/neighbors")
async def internal_graph_neighbors(request: Request, label: str, gid: str):
    """Pi graph_query 工具后端：指定节点一跳邻居子图。"""
    return await _graph_proxy(request, (label, gid))


async def _graph_proxy(request: Request, neighbors: tuple[str, str] | None):
    from app.graph import service as graph_service
    from app.graph.payload import NODE_LABELS, assemble_payload, neighbors_subgraph, node_key, scope_bfs

    state: AppState = request.app.state.app_state
    token_error = _check_internal_token(request, state.settings)
    if token_error:
        return token_error
    access, _user_id, access_error = await _resolve_access(request, state)
    if access_error:
        return access_error

    if neighbors and (neighbors[0] not in NODE_LABELS):
        return JSONResponse(status_code=400, content={"error": f"未知节点类型: {neighbors[0]}"})

    try:
        node_rows, edge_rows = await graph_service.fetch_raw_graph(state.pool)
    except Exception as exc:
        return JSONResponse(status_code=503, content={
            "error": f"图数据库不可用（需 AGE 扩展 + 图谱装载）: {exc}"})

    payload = assemble_payload(node_rows, edge_rows)
    if access.mode == "org":
        root = node_key("Org", access.org_code)
        allowed = scope_bfs(payload["nodes"], payload["edges"], root)
        payload = assemble_payload(node_rows, edge_rows, allowed_keys=allowed)
    if neighbors:
        label, gid = neighbors
        payload = neighbors_subgraph(payload, node_key(label, gid))
        if not payload["nodes"]:
            return JSONResponse(status_code=404, content={"error": "节点不存在或不在你的数据范围内"})
    return JSONResponse(content=payload)

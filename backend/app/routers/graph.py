"""知识图谱路由：Apache AGE 图数据 → Neo4j 风格可视化（前端 /graph 页面）。

行级权限沿用 OrgAccess 三态：
- unrestricted（admin / 未启用认证）：全图
- org：从本机构节点出发的 BFS 限深子图（机构树只向下）
- deny：403
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth.org_access import MODE_DENY, MODE_ORG, OrgAccess
from app.graph import service
from app.graph.payload import (
    NODE_LABELS,
    assemble_payload,
    neighbors_subgraph,
    node_key,
    scope_bfs,
)

router = APIRouter()


@router.get("/api/graph/overview")
async def graph_overview(request: Request):
    scoped, denied = await _scoped_payload(request)
    if denied:
        return denied
    scoped["access"] = _access_view(request)
    return JSONResponse(content=scoped)


@router.get("/api/graph/neighbors")
async def graph_neighbors(request: Request, label: str, gid: str):
    if label not in NODE_LABELS:
        return JSONResponse(status_code=400, content={"error": f"未知节点类型: {label}"})
    scoped, denied = await _scoped_payload(request)
    if denied:
        return denied
    sub = neighbors_subgraph(scoped, node_key(label, gid))
    if not sub["nodes"]:
        return JSONResponse(status_code=404, content={"error": "节点不存在或不在你的数据范围内"})
    sub["access"] = _access_view(request)
    return JSONResponse(content=sub)


@router.get("/api/graph/stats")
async def graph_stats(request: Request):
    """图规模统计（不做子图过滤——只暴露计数，不暴露明细）。"""
    try:
        node_rows, edge_rows = await service.fetch_raw_graph(_pool(request))
    except Exception as exc:
        return _graph_unavailable(exc)
    payload = assemble_payload(node_rows, edge_rows)
    return JSONResponse(content={"stats": payload["stats"]})


def _pool(request: Request):
    return request.app.state.app_state.pool


def _access_view(request: Request) -> dict:
    access = OrgAccess.for_user(getattr(request.state, "user", None))
    return {"mode": access.mode, "orgCode": access.org_code if access.mode == MODE_ORG else None}


async def _scoped_payload(request: Request):
    """全图装配 + org 模式子图过滤。返回 (payload, None) 或 (None, 错误响应)。"""
    access = OrgAccess.for_user(getattr(request.state, "user", None))
    if access.mode == MODE_DENY:
        return None, JSONResponse(status_code=403, content={
            "error": "当前账号未分配机构，无法查看业务数据，请联系管理员分配"})
    try:
        node_rows, edge_rows = await service.fetch_raw_graph(_pool(request))
    except Exception as exc:
        return None, _graph_unavailable(exc)

    payload = assemble_payload(node_rows, edge_rows)
    if access.mode == MODE_ORG:
        root = node_key("Org", access.org_code)
        allowed = scope_bfs(payload["nodes"], payload["edges"], root)
        payload = assemble_payload(node_rows, edge_rows, allowed_keys=allowed)
    return payload, None


def _graph_unavailable(exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=503, content={
        "error": f"图数据库不可用（需 AGE 扩展 + zz_graph_init.sql 装载）: {exc}"})

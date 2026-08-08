"""传统业务查询路由（对应 TS routes/traditional-query.ts + dicts.ts）。

契约/保全/理赔分页查询 + 详情 + CSV 导出 + 字典/机构下拉。
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.deps import AppState

router = APIRouter()


def _svc(request: Request):
    return request.app.state.app_state.insurance


def _pagination(body: dict) -> tuple[int, int, str | None, str | None]:
    page = max(1, int(body.get("page", 1)))
    page_size = min(100, max(1, int(body.get("pageSize", 10))))
    return page, page_size, body.get("sortBy"), body.get("sortOrder")


@router.post("/api/traditional/contract/query")
async def contract_query(request: Request):
    body = await request.json()
    page, size, sort_by, sort_order = _pagination(body)
    result = await _svc(request).query_contract(body.get("conditions") or {}, page, size, sort_by, sort_order)
    return JSONResponse(content=result)


@router.post("/api/traditional/preserve/query")
async def preserve_query(request: Request):
    body = await request.json()
    page, size, sort_by, sort_order = _pagination(body)
    result = await _svc(request).query_preserve(body.get("conditions") or {}, page, size, sort_by, sort_order)
    return JSONResponse(content=result)


@router.post("/api/traditional/claim/query")
async def claim_query(request: Request):
    body = await request.json()
    page, size, sort_by, sort_order = _pagination(body)
    result = await _svc(request).query_claim(body.get("conditions") or {}, page, size, sort_by, sort_order)
    return JSONResponse(content=result)


@router.get("/api/traditional/contract/{policy_id}/detail")
async def contract_detail(policy_id: str, request: Request):
    detail = await _svc(request).get_contract_detail(policy_id)
    if not detail:
        return JSONResponse(status_code=404, content={"error": "contract not found"})
    return JSONResponse(content=detail)


@router.get("/api/traditional/preserve/{preserve_id}/detail")
async def preserve_detail(preserve_id: str, request: Request):
    detail = await _svc(request).get_preserve_detail(preserve_id)
    if not detail:
        return JSONResponse(status_code=404, content={"error": "preserve not found"})
    return JSONResponse(content=detail)


@router.get("/api/traditional/claim/{claim_id}/detail")
async def claim_detail(claim_id: str, request: Request):
    detail = await _svc(request).get_claim_detail(claim_id)
    if not detail:
        return JSONResponse(status_code=404, content={"error": "claim not found"})
    return JSONResponse(content=detail)


@router.post("/api/traditional/contract/export")
async def contract_export(request: Request):
    body = await request.json()
    csv_text = await _svc(request).export_contract(body.get("conditions") or {})
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=contracts.csv"},
    )


@router.get("/api/dicts")
async def list_dicts(request: Request):
    dict_types = request.query_params.get("types")
    types = dict_types.split(",") if dict_types else None
    items = await _svc(request).list_dicts(types)
    return JSONResponse(content={"dicts": items})


@router.get("/api/orgs")
async def list_orgs(request: Request):
    orgs = await _svc(request).list_orgs()
    return JSONResponse(content={"orgs": orgs})

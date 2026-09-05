"""图数据装配（纯函数，供 routers/graph.py 与测试使用）。

Apache AGE 通过 asyncpg 返回的 agtype 一律是文本（顶点形如
'{"id":844424930131969,"label":"Org","properties":{...}}::vertex'，
标量形如 '"Org"'、'12'），本模块负责解析并组装前端 ECharts 需要的
{nodes, edges, categories, stats} 结构，以及机构行级权限的子图过滤。
"""
from __future__ import annotations

import json
from typing import Any

GRAPH_NAME = "insurance_graph"

# 合法节点标签（neighbors 接口入参白名单，防 Cypher 注入）
NODE_LABELS = ("Org", "SysUser", "Product", "Customer", "Policy", "Claim", "Preserve")

# 节点标签 → 前端展示分类名
LABEL_TITLES: dict[str, str] = {
    "Org": "机构",
    "SysUser": "员工",
    "Product": "产品",
    "Customer": "客户",
    "Policy": "保单",
    "Claim": "理赔",
    "Preserve": "保全",
}


def parse_agtype(text: str) -> Any:
    """agtype 文本 → Python 对象（剥掉 '::vertex' / '::edge' / '::path' 后缀再 JSON 解析）。"""
    if text is None:
        return None
    payload = text
    for suffix in ("::vertex", "::edge", "::path"):
        if payload.endswith(suffix):
            payload = payload[: -len(suffix)]
            break
    return json.loads(payload)


def node_key(label: str, gid: str) -> str:
    """前端节点唯一键：label:gid（业务 gid 各表前缀不同，但仍拼 label 保证全局唯一）。"""
    return f"{label}:{gid}"


def assemble_payload(node_rows: list[tuple], edge_rows: list[tuple],
                     allowed_keys: set[str] | None = None) -> dict:
    """把 cypher 查询行组装成前端图数据。

    node_rows: (label, gid, props) —— 来自 RETURN label(n), n.gid, properties(n)
    edge_rows: (src_label, src_gid, relation, dst_label, dst_gid, props)
               —— 来自 MATCH (a)-[r]->(b) RETURN label(a), a.gid, type(r), label(b), b.gid, properties(r)
    allowed_keys: 机构权限作用域（node_key 集合）；None = 不限制。
    """
    nodes: list[dict] = []
    seen: set[str] = set()
    for label, gid, props in node_rows:
        key = node_key(label, gid)
        if key in seen:
            continue
        seen.add(key)
        nodes.append({
            "id": key,
            "label": label,
            "name": _display_name(label, props),
            "props": props or {},
        })

    edges: list[dict] = []
    edge_seen: set[tuple] = set()
    for src_label, src_gid, relation, dst_label, dst_gid, props in edge_rows:
        source, target = node_key(src_label, src_gid), node_key(dst_label, dst_gid)
        if allowed_keys is not None and (source not in allowed_keys or target not in allowed_keys):
            continue
        dedupe = (source, target, relation)
        if dedupe in edge_seen:
            continue
        edge_seen.add(dedupe)
        edges.append({"id": f"{source}-{relation}->{target}",
                      "source": source, "target": target, "relation": relation,
                      "props": props or {}})

    if allowed_keys is not None:
        nodes = [n for n in nodes if n["id"] in allowed_keys]

    categories = [{"name": LABEL_TITLES[label]} for label in NODE_LABELS]
    stats = {
        "labels": _tally((n["label"] for n in nodes)),
        "relations": _tally((e["relation"] for e in edges)),
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
    }
    return {"categories": categories, "nodes": nodes, "edges": edges, "stats": stats}


def scope_bfs(nodes: list[dict], edges: list[dict], root_key: str,
              max_depth: int = 4) -> set[str]:
    """机构行级权限的子图作用域：从机构根节点出发 BFS max_depth 层可达的节点集合。

    深度覆盖：机构树(1) → 员工/保单(2) → 客户/产品/理赔/保全(3) → 审核人/受益人等(4)。
    CHILD_OF 只允许向下扩展（父机构 → 子机构）：org 权限用户不得经父机构
    看到兄弟分支；其余关系无向扩展（BELONGS_TO/ISSUED_BY 的端点方向互为反）。
    """
    reach: dict[str, list[str]] = {}
    for edge in edges:
        if edge["relation"] == "CHILD_OF":
            reach.setdefault(edge["target"], []).append(edge["source"])
        else:
            reach.setdefault(edge["source"], []).append(edge["target"])
            reach.setdefault(edge["target"], []).append(edge["source"])

    visited = {root_key}
    frontier = [root_key]
    depth = 0
    while frontier and depth < max_depth:
        next_frontier: list[str] = []
        for key in frontier:
            for neighbor in reach.get(key, ()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    next_frontier.append(neighbor)
        frontier = next_frontier
        depth += 1
    return visited


def neighbors_subgraph(payload: dict, node_id: str) -> dict:
    """取某节点的一跳邻居子图（节点 + 关联边，含自身）。"""
    keep = {node_id}
    for edge in payload["edges"]:
        if edge["source"] == node_id:
            keep.add(edge["target"])
        elif edge["target"] == node_id:
            keep.add(edge["source"])
    return {
        "categories": payload["categories"],
        "nodes": [n for n in payload["nodes"] if n["id"] in keep],
        "edges": [e for e in payload["edges"]
                  if e["source"] in keep and e["target"] in keep],
        "stats": payload["stats"],
    }


def _display_name(label: str, props: dict | None) -> str:
    if not props:
        return label
    return str(props.get("name") or props.get("gid") or label)


def _tally(values) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        result[value] = result.get(value, 0) + 1
    return result

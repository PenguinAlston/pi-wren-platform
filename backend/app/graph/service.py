"""图数据查询服务：Apache AGE Cypher 执行（经应用只读池）。

Cypher 一律通过 ag_catalog.cypher() 顶级 SRF 调用，返回列声明为 agtype，
asyncpg 拿到的是文本，解析与组装见 payload.py（纯函数）。
"""
from __future__ import annotations

import json

import asyncpg

from app.graph.payload import GRAPH_NAME, parse_agtype

# 节点/边装载上限（防误拉全量超大图；demo 种子规模远小于此）
MAX_NODES = 2000
MAX_EDGES = 5000

_NODES_CYPHER = f"""
    MATCH (n) RETURN label(n) AS label, n.gid AS gid, properties(n) AS props LIMIT {MAX_NODES}
"""

_EDGES_CYPHER = f"""
    MATCH (a)-[r]->(b)
    RETURN label(a) AS sl, a.gid AS sg, type(r) AS rel, label(b) AS dl, b.gid AS dg,
           properties(r) AS props
    LIMIT {MAX_EDGES}
"""


async def fetch_raw_graph(pool: asyncpg.Pool) -> tuple[list[tuple], list[tuple]]:
    """全量节点 + 边原始行（label, gid, props / src_label, src_gid, rel, dst_label, dst_gid, props）。"""
    async with pool.acquire() as conn:
        # AGE 会话初始化：加载扩展动态库并把 ag_catalog 纳入 search_path
        # （否则未限定名 agtype 报 type does not exist）；LOAD 不能在事务块内，单语句执行即可
        await conn.execute("LOAD 'age';")
        await conn.execute("SET search_path = ag_catalog, public;")
        node_rows = await conn.fetch(
            f"SELECT * FROM ag_catalog.cypher('{GRAPH_NAME}', $cy${_NODES_CYPHER}$cy$) "
            "AS (label agtype, gid agtype, props agtype)")
        edge_rows = await conn.fetch(
            f"SELECT * FROM ag_catalog.cypher('{GRAPH_NAME}', $cy${_EDGES_CYPHER}$cy$) "
            "AS (sl agtype, sg agtype, rel agtype, dl agtype, dg agtype, props agtype)")

    nodes = [(parse_agtype(r["label"]), parse_agtype(r["gid"]), parse_agtype(r["props"]))
             for r in node_rows]
    edges = [(parse_agtype(r["sl"]), parse_agtype(r["sg"]), parse_agtype(r["rel"]),
              parse_agtype(r["dl"]), parse_agtype(r["dg"]), parse_agtype(r["props"]))
             for r in edge_rows]
    return nodes, edges


def quote_param(payload: dict) -> str:
    """dict → agtype 字面量（JSON 文本；单引号转义供 SQL 内联）。"""
    return json.dumps(payload, ensure_ascii=False).replace("'", "''")

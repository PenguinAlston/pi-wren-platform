"""数据库内省：从 information_schema + pg_catalog 生成 WrenAI MDL JSON。

对应 TS services/context-engine/src/wren/db-introspect.ts（含代码评审后的修复：
约束列名由 pg_attribute 直接 join 返回，避免 attnum/ordinal_position 错配；
复合外键用 AND 连接；同表对多 FK 关系名去重）。

设计为纯逻辑：内省查询与 MDL 组装分离，组装逻辑用纯函数测，
DB 部分复用 app.data.db.create_pool（只读 + 30s 超时）。
"""
from __future__ import annotations

import json
from typing import Any

import asyncpg
import yaml

from app.data.db import create_pool

# PostgreSQL information_schema.columns.data_type → WrenAI/MDL 类型。
# 参考 semantic/wren/target/mdl.json 已有用法（大写）。未命中时回退大写原值。
_PG_TYPE_MAP: dict[str, str] = {
    "character varying": "VARCHAR",
    "character": "CHAR",
    "text": "TEXT",
    "integer": "INTEGER",
    "smallint": "SMALLINT",
    "bigint": "BIGINT",
    "numeric": "DECIMAL",
    "decimal": "DECIMAL",
    "real": "FLOAT4",
    "double precision": "FLOAT8",
    "boolean": "BOOLEAN",
    "date": "DATE",
    "timestamp without time zone": "TIMESTAMP",
    "timestamp with time zone": "TIMESTAMPTZ",
    "time without time zone": "TIME",
    "uuid": "UUID",
    "json": "JSON",
    "jsonb": "JSON",
    "bytea": "BLOB",
}


def map_pg_type(data_type: str) -> str:
    """把 PG data_type 映射为 MDL 类型。"""
    return _PG_TYPE_MAP.get(data_type.lower(), data_type.upper())


# 内省 SQL（schema 一律用 $1 参数化，杜绝注入）

_TABLES_SQL = """
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = $1 AND table_type = 'BASE TABLE'
    ORDER BY table_name
"""

_COLUMNS_SQL = """
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = $1
    ORDER BY table_name, ordinal_position
"""

# 关键：直接 join pg_attribute 把 conkey/confkey（attnum 数组）展开为列名数组返回，
# 不依赖 ordinal_position——后者是连续序号，而 attnum 在删列后会有空洞。
_CONSTRAINTS_SQL = """
    SELECT
        cls.relname AS table_name,
        con.contype,
        con.conname,
        (SELECT array_agg(a.attname ORDER BY k.ord)
           FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS col_names,
        rcls.relname AS ref_table,
        (SELECT array_agg(ra.attname ORDER BY k.ord)
           FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
           JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.attnum) AS ref_col_names
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    LEFT JOIN pg_class rcls ON rcls.oid = con.confrelid
    WHERE n.nspname = $1 AND con.contype IN ('p', 'f')
    ORDER BY cls.relname, con.contype
"""


async def introspect_database(conn: asyncpg.Connection, schema: str = "public") -> dict[str, list]:
    """从数据库内省出原始结构：tables/columns/constraints。"""
    tables = await conn.fetch(_TABLES_SQL, schema)
    columns = await conn.fetch(_COLUMNS_SQL, schema)
    constraints = await conn.fetch(_CONSTRAINTS_SQL, schema)
    return {"tables": [dict(r) for r in tables], "columns": [dict(r) for r in columns],
            "constraints": [dict(r) for r in constraints]}


def _as_str_list(value: Any) -> list[str]:
    """把约束查询返回的列名数组规整为 list[str]（asyncpg 返回 list/None，防御非字符串）。"""
    if not isinstance(value, (list, tuple)):
        return []
    return [v for v in value if isinstance(v, str) and v]


def _as_str(value: Any) -> str:
    """把单个值规整为 str：asyncpg 把 Postgres char 类型返回为 bytes（如 b'p'）。"""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return value if isinstance(value, str) else ""


def build_mdl(
    raw: dict[str, list],
    schema: str,
    descriptions: dict | None = None,
    catalog: str = "wren",
) -> dict:
    """把内省原始结构组装成 WrenAI MDL JSON。

    - 单列主键 → model.primaryKey（复合主键 MDL 无法表达，跳过）
    - 外键 → relationships（joinType 固定 MANY_TO_ONE；复合外键用 AND 连接多列）
    - 描述按表名/列名 merge 进 properties.description
    """
    descriptions = descriptions or {}
    desc_models = descriptions.get("models", {}) if isinstance(descriptions, dict) else {}

    # table → 单列主键名（仅当主键约束只有一列时；复合主键不写 primaryKey）
    pk_by_table: dict[str, str] = {}
    # 外键列表：table→refTable 的多列对（保持 conkey/confkey 顺序对齐）
    fks: list[dict] = []
    for con in raw["constraints"]:
        cols = _as_str_list(con.get("col_names"))
        # asyncpg 把 pg_constraint.contype（Postgres char 类型）返回为 bytes（如 b'p'），
        # 不是 str；这里统一解码，避免 contype 比较恒为 False 导致 PK/FK 全部丢失。
        contype = _as_str(con.get("contype"))
        if contype == "p":
            if len(cols) == 1:
                pk_by_table[con["table_name"]] = cols[0]
        elif contype == "f" and con.get("ref_table") and cols:
            ref_cols = _as_str_list(con.get("ref_col_names"))
            if len(ref_cols) == len(cols):
                fks.append({"table": con["table_name"], "cols": cols,
                            "ref_table": con["ref_table"], "ref_cols": ref_cols})

    table_names = {t["table_name"] for t in raw["tables"]}

    models: list[dict] = []
    for t in raw["tables"]:
        desc_entry = desc_models.get(t["table_name"], {}) if isinstance(desc_models, dict) else {}
        model_desc = desc_entry.get("description") if isinstance(desc_entry, dict) else None
        columns_out: list[dict] = []
        for c in [col for col in raw["columns"] if col["table_name"] == t["table_name"]]:
            col_desc = (desc_entry.get("columns", {}) or {}).get(c["column_name"]) if isinstance(desc_entry, dict) else None
            column: dict[str, Any] = {"name": c["column_name"], "type": map_pg_type(c["data_type"])}
            if col_desc:
                column["properties"] = {"description": col_desc}
            columns_out.append(column)
        model: dict[str, Any] = {
            "name": t["table_name"],
            "tableReference": {"schema": schema, "table": t["table_name"]},
            "columns": columns_out,
        }
        if model_desc:
            model["properties"] = {"description": model_desc}
        pk = pk_by_table.get(t["table_name"])
        if pk:
            model["primaryKey"] = pk
        models.append(model)

    # 仅保留两端表都真实存在的物理表的外键；relationship 名称全局唯一去重
    used_names: set[str] = set()
    relationships: list[dict] = []
    for fk in fks:
        if fk["table"] not in table_names or fk["ref_table"] not in table_names:
            continue
        base_name = f"{fk['table']}_{fk['ref_table']}"
        name = base_name
        if name in used_names:
            name = f"{fk['table']}_{'_'.join(fk['cols'])}_{fk['ref_table']}"
        suffix = 2
        while name in used_names:
            name = f"{base_name}_{suffix}"
            suffix += 1
        used_names.add(name)
        condition = " AND ".join(
            f"{fk['table']}.{col} = {fk['ref_table']}.{fk['ref_cols'][i]}" for i, col in enumerate(fk["cols"])
        )
        relationships.append({
            "name": name,
            "models": [fk["table"], fk["ref_table"]],
            "joinType": "MANY_TO_ONE",
            "condition": condition,
        })

    return {
        "catalog": catalog, "schema": schema, "models": models, "relationships": relationships,
        "views": [], "cubes": [], "dataSource": "postgres", "layoutVersion": 3,
    }


def parse_description_map(text: str | None) -> dict:
    """把前端传入的描述补充文本解析为 {models: {...}}。同时接受 JSON 与 YAML。

    空串/解析失败返回 {}（不抛错）。
    """
    if not text:
        return {}
    text = text.strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text) if text.startswith("{") else yaml.safe_load(text)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    # 兼容两种写法：{ models: {...} } 或直接 { 表名: {...} }
    models = parsed.get("models", parsed)
    if not isinstance(models, dict):
        return {}
    result: dict[str, dict] = {}
    for table, val in models.items():
        if not isinstance(val, dict):
            continue
        entry: dict[str, Any] = {}
        if isinstance(val.get("description"), str):
            entry["description"] = val["description"]
        cols = val.get("columns")
        if isinstance(cols, dict):
            entry["columns"] = {k: v for k, v in cols.items() if isinstance(v, str)}
        if entry:
            result[str(table)] = entry
    return {"models": result}


async def generate_mdl_from_db(db: dict, schema: str = "public", descriptions_text: str | None = None) -> dict:
    """顶层编排：建临时只读池 → 内省 → 组装 MDL → 关池。

    db 形如 {host, port, database, user, password, max?}（来自 admin_agents._db_schema）。
    返回 MDL manifest dict。
    """
    # create_pool 只接受特定 kwargs，剔除 db 里多余的 max 等字段
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
            raw = await introspect_database(conn, schema)
        desc_map = parse_description_map(descriptions_text)
        return build_mdl(raw, schema, desc_map)
    finally:
        await pool.close()

#!/usr/bin/env python3
"""AGE 1.7+ 图谱装载器：\bind 扩展协议传参（替代 ::text::agtype 字面量第三参）。

用法：python3 load_graph_age17.py   （在宿主机上跑，经 docker exec 操作 psql）
原理：先从业务表抽 JSON（json_agg），生成 psql \bind 脚本，再管道进容器 psql 执行。
"""
import json
import subprocess

PSQL = ["docker", "exec", "-i", "pi-wren-prod-postgres-1", "psql", "-U", "demo", "-d", "piwren"]
DUMP_PSQL = PSQL + ["-At", "-v", "ON_ERROR_STOP=1"]  # 数据抽取：无表头不折行


def psql(sql: str, use_db: bool = True) -> str:
    cmd = DUMP_PSQL if use_db else PSQL[:6] + ["psql", "-U", "demo", "-d", "postgres"]
    result = subprocess.run(cmd, input=sql.encode(), capture_output=True)
    out = result.stdout.decode()
    if result.returncode != 0:
        raise RuntimeError(f"psql 失败: {result.stderr.decode()[:500]}")
    return out


def dump_rows(sql: str) -> str:
    """业务表 → 单行 JSON 字符串 {"rows": [...]}（作为 bind 参数值）。"""
    out = psql(f"SELECT COALESCE(json_agg(t), '[]'::json)::text FROM ({sql}) t")
    return "".join(out.splitlines()).strip()


# (说明, dump SQL, cypher 主体) —— cypher 均以 UNWIND $rows AS r 开头，属性键与 dump 对齐
LOADS = [
    ("机构节点",
     "SELECT org_id AS gid, org_name AS name, org_short_name AS \"shortName\", org_level AS \"level\" FROM sys_org",
     "CREATE (:Org {gid: r.gid, name: r.name, shortName: r.shortName, level: r.level})"),
    ("员工节点",
     "SELECT user_id AS gid, user_name AS name, user_type AS \"userType\" FROM sys_user",
     "CREATE (:SysUser {gid: r.gid, name: r.name, userType: r.userType})"),
    ("产品节点",
     "SELECT product_id AS gid, product_name AS name, product_type AS \"productType\", product_status AS status FROM ins_product_main",
     "CREATE (:Product {gid: r.gid, name: r.name, productType: r.productType, status: r.status})"),
    ("客户节点",
     "SELECT customer_id AS gid, customer_name AS name, gender AS gender FROM ins_customer",
     "CREATE (:Customer {gid: r.gid, name: r.name, gender: r.gender})"),
    ("保单节点",
     "SELECT policy_id AS gid, policy_no AS name, policy_status AS status, year_premium AS premium, total_amount AS \"totalAmount\" FROM ins_policy_main",
     "CREATE (:Policy {gid: r.gid, name: r.name, status: r.status, premium: r.premium, totalAmount: r.totalAmount})"),
    ("理赔节点",
     "SELECT claim_id AS gid, claim_id AS name, claim_type AS \"claimType\", claim_status AS status, apply_claim_amount AS \"applyAmount\" FROM ins_claim_main",
     "CREATE (:Claim {gid: r.gid, name: r.name, claimType: r.claimType, status: r.status, applyAmount: r.applyAmount})"),
    ("保全节点",
     "SELECT preserve_id AS gid, preserve_id AS name, preserve_type AS \"preserveType\", preserve_status AS status FROM ins_preserve_main",
     "CREATE (:Preserve {gid: r.gid, name: r.name, preserveType: r.preserveType, status: r.status})"),
    # --- 关系（_src/_dst 为两端节点 gid）---
    ("机构树",
     "SELECT org_id AS _src, parent_org_id AS _dst FROM sys_org WHERE parent_org_id IS NOT NULL",
     "MATCH (a:Org {gid: r._src}), (b:Org {gid: r._dst}) CREATE (a)-[:CHILD_OF]->(b)"),
    ("员工归属",
     "SELECT user_id AS _src, org_id AS _dst FROM sys_user",
     "MATCH (a:SysUser {gid: r._src}), (b:Org {gid: r._dst}) CREATE (a)-[:BELONGS_TO]->(b)"),
    ("投保人",
     "SELECT applicant_id AS _src, policy_id AS _dst FROM ins_policy_main",
     "MATCH (a:Customer {gid: r._src}), (b:Policy {gid: r._dst}) CREATE (a)-[:APPLICANT_OF]->(b)"),
    ("被保人",
     "SELECT insured_id AS _src, policy_id AS _dst FROM ins_policy_main",
     "MATCH (a:Customer {gid: r._src}), (b:Policy {gid: r._dst}) CREATE (a)-[:INSURED_OF]->(b)"),
    ("受益人",
     "SELECT customer_id AS _src, policy_id AS _dst, benefit_rate AS rate, benefit_level AS level FROM ins_policy_benefit",
     "MATCH (a:Customer {gid: r._src}), (b:Policy {gid: r._dst}) CREATE (a)-[:BENEFICIARY_OF {rate: r.rate, level: r.level}]->(b)"),
    ("承保产品",
     "SELECT policy_id AS _src, product_id AS _dst FROM ins_policy_main",
     "MATCH (a:Policy {gid: r._src}), (b:Product {gid: r._dst}) CREATE (a)-[:OF_PRODUCT]->(b)"),
    ("出单机构",
     "SELECT policy_id AS _src, org_code AS _dst FROM ins_policy_main",
     "MATCH (a:Policy {gid: r._src}), (b:Org {gid: r._dst}) CREATE (a)-[:ISSUED_BY]->(b)"),
    ("附加险",
     "SELECT DISTINCT s.policy_id AS _src, s.rider_product_id AS _dst FROM ins_policy_rider s WHERE EXISTS (SELECT 1 FROM ins_product_main m WHERE m.product_id = s.rider_product_id)",
     "MATCH (a:Policy {gid: r._src}), (b:Product {gid: r._dst}) CREATE (a)-[:HAS_RIDER]->(b)"),
    ("理赔归属",
     "SELECT policy_id AS _src, claim_id AS _dst FROM ins_claim_main",
     "MATCH (a:Policy {gid: r._src}), (b:Claim {gid: r._dst}) CREATE (a)-[:HAS_CLAIM]->(b)"),
    ("保全归属",
     "SELECT policy_id AS _src, preserve_id AS _dst FROM ins_preserve_main",
     "MATCH (a:Policy {gid: r._src}), (b:Preserve {gid: r._dst}) CREATE (a)-[:HAS_PRESERVE]->(b)"),
    ("核保人",
     "SELECT DISTINCT underwrite_user AS _src, policy_id AS _dst FROM ins_policy_underwrite",
     "MATCH (a:SysUser {gid: r._src}), (b:Policy {gid: r._dst}) CREATE (a)-[:UNDERWROTE]->(b)"),
    ("理赔审核人",
     "SELECT DISTINCT audit_user_id AS _src, claim_id AS _dst FROM ins_claim_audit",
     "MATCH (a:SysUser {gid: r._src}), (b:Claim {gid: r._dst}) CREATE (a)-[:AUDITED]->(b)"),
    ("保全申请人",
     "SELECT apply_customer_id AS _src, preserve_id AS _dst FROM ins_preserve_main",
     "MATCH (a:Customer {gid: r._src}), (b:Preserve {gid: r._dst}) CREATE (a)-[:APPLIED_PRESERVE]->(b)"),
]


def rel_type(cypher: str) -> str:
    return cypher.split("]-[:", 1)[1].split("]", 1)[0]



def to_cypher_list_literal(rows: list[dict]) -> str:
    """行 → Cypher map 字面量列表（无引号键 + 单引号字符串转义）。"""
    items = []
    for row in rows:
        pairs = []
        for k, v in row.items():
            if v is None:
                sv = "null"
            elif isinstance(v, bool):
                sv = "true" if v else "false"
            elif isinstance(v, (int, float)):
                sv = repr(v)
            else:
                sv = "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"
            pairs.append(f"{k}: {sv}")
        items.append("{" + ", ".join(pairs) + "}")
    return "[" + ", ".join(items) + "]"


def main() -> None:
    header = [
        "\\set ON_ERROR_STOP on",
        "CREATE EXTENSION IF NOT EXISTS age;",
        "LOAD 'age';",
        'SET search_path = ag_catalog, "$user", public;',
        "DO $$ BEGIN PERFORM drop_graph('insurance_graph', true); EXCEPTION WHEN OTHERS THEN NULL; END $$;",
        "SELECT create_graph('insurance_graph');",
    ]
    script: list[str] = header

    for idx, (name, dump_sql, cypher) in enumerate(LOADS):
        rows = json.loads(dump_rows(dump_sql))
        if not rows:
            script.append(f"-- {name}: 0 行，跳过")
            continue
        # AGE 1.7 拒绝字面量第三参（必须扩展协议参数）→ 直接内联 map 字面量，无第三参
        literal = to_cypher_list_literal(rows)
        script.append(f"SELECT * FROM ag_catalog.cypher('insurance_graph', $cy$ UNWIND {literal} AS r {cypher} $cy$) AS (v agtype);")
        script.append(f"-- {name}: {len(rows)} 行")
    script.append("SELECT '装载完成' AS done;")

    payload = "\n".join(script) + "\n"
    result = subprocess.run(PSQL, input=payload.encode(), capture_output=True)
    out = result.stdout.decode()
    print(out[-1500:])
    if result.returncode != 0:
        print("STDERR:", result.stderr.decode()[-800:])
        raise SystemExit(1)
    print(">>> 图谱装载完成")


if __name__ == "__main__":
    main()

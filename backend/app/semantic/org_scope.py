"""SQL 机构维度强制（sqlglot AST 级，fail-closed）。

对受 org_code 约束的业务表（ins_policy_main / ins_claim_main / ins_preserve_main）：
- org 模式：SQL 中每处引用都必须带指向本机构的谓词（``<别名>.org_code = '<org>'``
  或 IN 列表含该值，WHERE / JOIN ON 皆可），缺失或值不符即报错——错误会作为
  提示回传 LLM 重新生成（流水线自带重试）；
- deny 模式：SQL 触达任一受约束表即拒绝；
- unrestricted：不干预（admin / 认证未启用 / 自定义 Agent 的空表集）。

校验按"引用处最近的 SELECT"逐个判定：CTE 体、FROM 子查询、EXISTS 子查询
各自独立检查；限定名按表别名/表名匹配，未限定名仅在该 SELECT 只引用一个
受约束表时计入（否则视为歧义，不放行）。
"""
from __future__ import annotations

from typing import Iterable

import sqlglot
from sqlglot import exp

from app.auth.org_access import MODE_DENY, MODE_ORG, MODE_UNRESTRICTED, OrgAccess

# 带 org_code 列且 NOT NULL 的业务表（infra/postgres/insurance_schema.sql）
ORG_SCOPED_TABLES: tuple[str, ...] = ("ins_policy_main", "ins_claim_main", "ins_preserve_main")

_ORG_COLUMN = "org_code"


def sql_touched_scoped_tables(sql: str, scoped_tables: Iterable[str] = ORG_SCOPED_TABLES) -> set[str]:
    """SQL 触达的受约束表名（小写）。解析失败时保守返回含哨兵的非空集（按违规处理）。"""
    scoped = {t.lower() for t in scoped_tables}
    if not scoped:
        return set()
    try:
        tree = sqlglot.parse_one(sql, read="postgres")
    except sqlglot.errors.ParseError:
        return {"<unparsed>"}
    return {t.name.lower() for t in tree.find_all(exp.Table) if t.name.lower() in scoped}


def _table_keys(table: exp.Table) -> set[str]:
    """能限定该表引用的标识符：表名 + 别名（小写）。"""
    keys = {table.name.lower()}
    if table.alias:
        keys.add(table.alias.lower())
    return keys


def _literal_value(node: exp.Expression) -> str | None:
    """取谓词右值的字符串字面量（兼容 'X'::text 的 Cast 包裹）。"""
    if isinstance(node, exp.Cast):
        node = node.this
    if isinstance(node, exp.Literal):
        return str(node.this)
    return None


def _conditions_cover_org(conditions: list[exp.Expression | None], keys: set[str],
                          allow_unqualified: bool, org_code: str) -> bool:
    """条件集合（WHERE + JOIN ON）里是否存在指向本表的 org_code =/IN '<org>'。"""
    for cond in conditions:
        if cond is None:
            continue
        for pred in cond.find_all(exp.EQ, exp.In):
            if isinstance(pred, exp.EQ):
                left, right = pred.this, pred.expression
                pairs = [(left, right), (right, left)]
            else:
                # IN：左值是列，右值是字面量列表
                if not _is_org_column(pred.this, keys, allow_unqualified):
                    continue
                if any(_literal_value(item) == org_code for item in pred.expressions):
                    return True
                continue
            for col, value in pairs:
                if _is_org_column(col, keys, allow_unqualified) and _literal_value(value) == org_code:
                    return True
    return False


def _is_org_column(node: exp.Expression | None, keys: set[str], allow_unqualified: bool) -> bool:
    if not isinstance(node, exp.Column) or node.name.lower() != _ORG_COLUMN:
        return False
    qualifier = node.table  # 限定名（p.org_code 的 p）；未限定时为空串
    if qualifier:
        return qualifier.lower() in keys
    return allow_unqualified


def _missing_org_predicates(sql: str, org_code: str,
                            scoped_tables: Iterable[str]) -> list[str]:
    """org 模式：返回缺谓词的受约束表名列表（去重排序）。"""
    scoped = {t.lower() for t in scoped_tables}
    tree = sqlglot.parse_one(sql, read="postgres")
    missing: set[str] = set()
    for table in tree.find_all(exp.Table):
        if table.name.lower() not in scoped:
            continue
        select = table.find_ancestor(exp.Select)
        if select is None:
            # INSERT/DELETE 等语句里的表引用（本地校验层本就会拦，双保险视为违规）
            missing.add(table.name)
            continue
        keys = _table_keys(table)
        # 该 SELECT 里引用了几个受约束表：>1 时未限定的 org_code 视为歧义不放行
        scoped_here = {
            t.name.lower()
            for t in select.find_all(exp.Table)
            if t.name.lower() in scoped
        }
        where = select.args.get("where")
        conditions: list[exp.Expression | None] = [where.this if where else None]
        for join in select.args.get("joins") or []:
            conditions.append(join.args.get("on"))
        if not _conditions_cover_org(conditions, keys,
                                     allow_unqualified=len(scoped_here) <= 1,
                                     org_code=org_code):
            missing.add(table.name)
    return sorted(missing)


def enforce_org_access(sql: str, access: OrgAccess | None,
                       scoped_tables: Iterable[str] = ORG_SCOPED_TABLES) -> str | None:
    """对生成的 SQL 强制机构权限。返回错误信息（违规）或 None（放行）。

    access=None / unrestricted / 受约束表集为空 → 不干预（自定义 Agent 安全）。
    """
    if access is None or not access.restricted or not list(scoped_tables):
        return None
    touched = sql_touched_scoped_tables(sql, scoped_tables)
    if not touched:
        return None
    if access.mode == MODE_DENY:
        return (f"数据权限不足：SQL 触达机构维度的业务表 {sorted(touched)}，"
                "当前账号未分配机构。请改用不涉及这些表的查询，或提示用户联系管理员分配机构。")
    if access.mode == MODE_ORG:
        assert access.org_code is not None
        try:
            missing = _missing_org_predicates(sql, access.org_code, scoped_tables)
        except sqlglot.errors.ParseError:
            return "SQL 解析失败，无法完成数据权限校验"
        if missing:
            org = access.org_code
            return (f"数据权限约束：表 {missing} 的查询缺少机构过滤。"
                    f"必须对每处引用添加 org_code 谓词（WHERE 或 JOIN ON 均可），"
                    f"且值必须逐字为 '{org}'，例如 p.org_code = '{org}'；"
                    "不得使用其他机构、模糊匹配或函数包装。")
    return None


def org_prompt_instructions(access: OrgAccess,
                            scoped_tables: Iterable[str] = ORG_SCOPED_TABLES) -> str:
    """org 模式注入 SQL 生成提示词的数据范围约束（让 LLM 首次生成即合规）。"""
    if not (access.mode == MODE_ORG and access.org_code):
        return ""
    tables = "、".join(scoped_tables)
    org = access.org_code
    return (
        f"Data access scope (MANDATORY): the business tables {tables} carry an org_code column. "
        f"You MUST filter EVERY reference to these tables with org_code = '{org}' exactly "
        f"(e.g. p.org_code = '{org}', in WHERE or JOIN ON), regardless of what the user asks. "
        "Never query other orgs, never use fuzzy matching or functions around org_code."
    )

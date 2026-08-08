"""传统保险查询（对应 TS services/insurance-query + routes/traditional-query.ts）。

契约/保全/理赔分页查询 + 详情 + CSV 导出 + 字典/机构下拉。
"""
from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import asyncpg


def _json_ready(value: Any) -> Any:
    """asyncpg 返回值转 JSON 友好类型（Decimal → float，日期 → iso）。"""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row_ready(row: asyncpg.Record | dict) -> dict:
    return {k: _json_ready(v) for k, v in (dict(row) if isinstance(row, asyncpg.Record) else row).items()}


def escape_like(input_str: str) -> str:
    """LIKE 模糊匹配参数转义：\\ % _ 前缀反斜杠，防通配符注入。"""
    return re.sub(r"[\\%_]", lambda m: f"\\{m.group(0)}", input_str)


class ConditionBuilder:
    """参数化条件构建器：列名来自白名单常量，值只出现在 $N 参数位。"""

    def __init__(self):
        self.clauses: list[str] = []
        self.params: list[Any] = []

    def eq(self, column: str, value: Any) -> "ConditionBuilder":
        if value is None or value == "":
            return self
        self.params.append(value)
        self.clauses.append(f"{column} = ${len(self.params)}")
        return self

    def gte(self, column: str, value: Any, cast: str) -> "ConditionBuilder":
        if value is None or value == "":
            return self
        self.params.append(value)
        self.clauses.append(f"{column} >= ${len(self.params)}::{cast}")
        return self

    def lte(self, column: str, value: Any, cast: str) -> "ConditionBuilder":
        if value is None or value == "":
            return self
        self.params.append(value)
        self.clauses.append(f"{column} <= ${len(self.params)}::{cast}")
        return self

    def like(self, column: str, value: str | None) -> "ConditionBuilder":
        if value is None or value.strip() == "":
            return self
        self.params.append(escape_like(value.strip()))
        # LIKE 默认 ESCAPE 就是 \（escape_like 已转义 \ % _），无需显式 ESCAPE 子句，
        # 避免 asyncpg prepare 阶段对字面反斜杠的转义歧义导致 InvalidEscapeSequenceError
        self.clauses.append(f"{column} LIKE '%' || ${len(self.params)} || '%'")
        return self

    def build(self, select: str, default_order: str, page: int, page_size: int,
              sort_by: str | None, sort_order: str | None, sort_columns: dict[str, str]) -> dict:
        where = f"WHERE {' AND '.join(self.clauses)}" if self.clauses else ""
        order = self._resolve_order(default_order, sort_by, sort_order, sort_columns)
        offset = (page - 1) * page_size
        sql = f"{select} {where} ORDER BY {order} LIMIT {page_size} OFFSET {offset}"
        count_sql = f"SELECT COUNT(*) AS total FROM ({select} {where}) t"
        return {"sql": sql, "params": self.params, "count_sql": count_sql, "count_params": self.params}

    @staticmethod
    def _resolve_order(default_order: str, sort_by: str | None, sort_order: str | None,
                       sort_columns: dict[str, str]) -> str:
        expr = sort_columns.get(sort_by or "")
        if not expr:
            return default_order
        order = "ASC" if sort_order == "asc" else "DESC"
        return f"{expr} {order}"


# ---------------------------------------------------------------------
# 契约查询（需求 3.3）
# ---------------------------------------------------------------------

CONTRACT_SELECT = """
SELECT p.policy_id, p.policy_no, p.product_id, p.product_type, p.product_name,
       p.policy_status, ps.dict_label AS policy_status_label,
       p.pay_type, pt.dict_label AS pay_type_label, p.pay_year,
       p.year_premium, p.total_premium, p.total_amount,
       p.apply_date, p.effect_date, p.end_date,
       p.channel_type, pc.dict_label AS channel_label,
       p.org_code, o.org_name,
       a.customer_name AS applicant_name, a.id_no AS applicant_id_no, a.phone AS applicant_phone,
       i.customer_name AS insured_name, i.id_no AS insured_id_no, i.phone AS insured_phone
FROM ins_policy_main p
LEFT JOIN sys_dict ps ON ps.dict_type = 'policy_status' AND ps.dict_value = p.policy_status
LEFT JOIN sys_dict pt ON pt.dict_type = 'pay_type' AND pt.dict_value = p.pay_type
LEFT JOIN sys_dict pc ON pc.dict_type = 'channel_type' AND pc.dict_value = p.channel_type
LEFT JOIN sys_org o ON o.org_id = p.org_code
LEFT JOIN ins_customer a ON a.customer_id = p.applicant_id
LEFT JOIN ins_customer i ON i.customer_id = p.insured_id
"""

CONTRACT_SORT_COLUMNS = {
    "applyDate": "p.apply_date",
    "yearPremium": "p.year_premium",
    "endDate": "p.end_date",
}


def build_contract_query(cond: dict, page: int, page_size: int, sort_by=None, sort_order=None) -> dict:
    b = ConditionBuilder()
    b.like("p.policy_no", cond.get("policyNo"))
    b.eq("p.product_type", cond.get("productType"))
    b.eq("p.policy_status", cond.get("policyStatus"))
    b.like("c.customer_name", cond.get("applicantName"))
    b.like("a.id_no", cond.get("applicantIdNo"))
    b.like("i.customer_name", cond.get("insuredName"))
    b.like("i.id_no", cond.get("insuredIdNo"))
    b.eq("p.org_code", cond.get("orgCode"))
    b.eq("p.channel_type", cond.get("channelType"))
    b.gte("p.apply_date", cond.get("applyDateFrom"), "date")
    b.lte("p.apply_date", cond.get("applyDateTo"), "date")
    b.gte("p.year_premium", cond.get("premiumMin"), "numeric")
    b.lte("p.year_premium", cond.get("premiumMax"), "numeric")
    return b.build(CONTRACT_SELECT, "p.apply_date DESC", page, page_size, sort_by, sort_order, CONTRACT_SORT_COLUMNS)


# ---------------------------------------------------------------------
# 保全查询（需求 3.4）
# ---------------------------------------------------------------------

PRESERVE_SELECT = """
SELECT m.preserve_id, m.policy_id, p.policy_no,
       m.preserve_type, pt.dict_label AS preserve_type_label,
       m.preserve_status, ps.dict_label AS preserve_status_label,
       m.apply_time, m.audit_time, u.user_name AS audit_user_name,
       m.change_desc, m.org_code, o.org_name,
       c.customer_name AS applicant_name
FROM ins_preserve_main m
LEFT JOIN ins_policy_main p ON p.policy_id = m.policy_id
LEFT JOIN sys_dict pt ON pt.dict_type = 'preserve_type' AND pt.dict_value = m.preserve_type
LEFT JOIN sys_dict ps ON ps.dict_type = 'preserve_status' AND ps.dict_value = m.preserve_status
LEFT JOIN ins_customer c ON c.customer_id = m.apply_customer_id
LEFT JOIN sys_user u ON u.user_id = m.audit_user_id
LEFT JOIN sys_org o ON o.org_id = m.org_code
"""

PRESERVE_SORT_COLUMNS = {
    "applyTime": "m.apply_time",
    "preserveType": "m.preserve_type",
}


def build_preserve_query(cond: dict, page: int, page_size: int, sort_by=None, sort_order=None) -> dict:
    b = ConditionBuilder()
    b.like("m.preserve_id", cond.get("preserveId"))
    b.like("p.policy_no", cond.get("policyId"))
    b.eq("m.preserve_type", cond.get("preserveType"))
    b.eq("m.preserve_status", cond.get("preserveStatus"))
    b.like("c.customer_name", cond.get("applicantName"))
    b.gte("m.apply_time", cond.get("applyTimeFrom"), "timestamp")
    b.lte("m.apply_time", cond.get("applyTimeTo"), "timestamp")
    return b.build(PRESERVE_SELECT, "m.apply_time DESC", page, page_size, sort_by, sort_order, PRESERVE_SORT_COLUMNS)


# ---------------------------------------------------------------------
# 理赔查询（需求 3.5）
# ---------------------------------------------------------------------

CLAIM_SELECT = """
SELECT c.claim_id, c.policy_id, p.policy_no,
       c.claim_type, ct.dict_label AS claim_type_label,
       c.claim_status, cs.dict_label AS claim_status_label,
       c.insured_id, i.customer_name AS insured_name, i.id_no AS insured_id_no,
       c.accident_time, c.report_time, c.accident_area,
       c.apply_claim_amount, c.actual_claim_amount, c.close_time, c.claim_reason
FROM ins_claim_main c
LEFT JOIN ins_policy_main p ON p.policy_id = c.policy_id
LEFT JOIN sys_dict ct ON ct.dict_type = 'claim_type' AND ct.dict_value = c.claim_type
LEFT JOIN sys_dict cs ON cs.dict_type = 'claim_status' AND cs.dict_value = c.claim_status
LEFT JOIN ins_customer i ON i.customer_id = c.insured_id
"""

CLAIM_SORT_COLUMNS = {
    "reportTime": "c.report_time",
    "actualClaimAmount": "c.actual_claim_amount",
    "closeTime": "c.close_time",
}


def build_claim_query(cond: dict, page: int, page_size: int, sort_by=None, sort_order=None) -> dict:
    b = ConditionBuilder()
    b.like("c.claim_id", cond.get("claimId"))
    b.like("p.policy_no", cond.get("policyId"))
    b.eq("c.claim_type", cond.get("claimType"))
    b.eq("c.claim_status", cond.get("claimStatus"))
    b.like("i.customer_name", cond.get("insuredName"))
    b.like("i.id_no", cond.get("insuredIdNo"))
    b.gte("c.report_time", cond.get("reportTimeFrom"), "timestamp")
    b.lte("c.report_time", cond.get("reportTimeTo"), "timestamp")
    b.like("c.accident_area", cond.get("accidentArea"))
    b.gte("c.actual_claim_amount", cond.get("claimAmountMin"), "numeric")
    b.lte("c.actual_claim_amount", cond.get("claimAmountMax"), "numeric")
    return b.build(CLAIM_SELECT, "c.report_time DESC", page, page_size, sort_by, sort_order, CLAIM_SORT_COLUMNS)


# ---------------------------------------------------------------------
# 脱敏（对应 TS masking.ts）
# ---------------------------------------------------------------------

def mask_name(name: str | None) -> str | None:
    """姓名脱敏：张三 → 张*。"""
    if not name or len(name) < 2:
        return name
    return name[0] + "*" * (len(name) - 1)


def mask_id_no(id_no: str | None) -> str | None:
    """身份证号脱敏：前 4 后 4。"""
    if not id_no or len(id_no) < 8:
        return id_no
    return id_no[:4] + "*" * (len(id_no) - 8) + id_no[-4:]


def mask_phone(phone: str | None) -> str | None:
    """手机号脱敏：前 3 后 4。"""
    if not phone or len(phone) < 7:
        return phone
    return phone[:3] + "*" * (len(phone) - 7) + phone[-4:]


def mask_contract_row(row: dict) -> dict:
    return {
        **row,
        "applicant_name": mask_name(row.get("applicant_name")),
        "insured_name": mask_name(row.get("insured_name")),
        "applicant_id_no": mask_id_no(row.get("applicant_id_no")),
        "insured_id_no": mask_id_no(row.get("insured_id_no")),
        "applicant_phone": mask_phone(row.get("applicant_phone")),
        "insured_phone": mask_phone(row.get("insured_phone")),
    }


def mask_claim_row(row: dict) -> dict:
    return {
        **row,
        "insured_name": mask_name(row.get("insured_name")),
        "insured_id_no": mask_id_no(row.get("insured_id_no")),
    }


# ---------------------------------------------------------------------
# 服务（对应 TS InsuranceQueryService）
# ---------------------------------------------------------------------

class InsuranceQueryService:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    async def query_contract(self, cond: dict, page: int, page_size: int,
                             sort_by=None, sort_order=None) -> dict:
        return await self._run_list(build_contract_query(cond, page, page_size, sort_by, sort_order),
                                    mask_contract_row, page, page_size)

    async def query_preserve(self, cond: dict, page: int, page_size: int,
                             sort_by=None, sort_order=None) -> dict:
        return await self._run_list(build_preserve_query(cond, page, page_size, sort_by, sort_order),
                                    lambda r: r, page, page_size)

    async def query_claim(self, cond: dict, page: int, page_size: int,
                          sort_by=None, sort_order=None) -> dict:
        return await self._run_list(build_claim_query(cond, page, page_size, sort_by, sort_order),
                                    mask_claim_row, page, page_size)

    async def list_dicts(self, dict_types: list[str] | None = None) -> list[dict]:
        async with self._pool.acquire() as conn:
            if dict_types:
                rows = await conn.fetch(
                    "SELECT dict_type, dict_value AS value, dict_label AS label, sort_num "
                    "FROM sys_dict WHERE dict_type = ANY($1) ORDER BY dict_type, sort_num",
                    dict_types,
                )
            else:
                rows = await conn.fetch(
                    "SELECT dict_type, dict_value AS value, dict_label AS label, sort_num "
                    "FROM sys_dict ORDER BY dict_type, sort_num"
                )
        return [_row_ready(r) for r in rows]

    async def list_orgs(self) -> list[dict]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT org_id, org_name, org_level FROM sys_org ORDER BY org_id"
            )
        return [_row_ready(r) for r in rows]

    async def get_contract_detail(self, policy_id: str) -> dict | None:
        async with self._pool.acquire() as conn:
            policy = await conn.fetchrow(f"{CONTRACT_SELECT} WHERE p.policy_id = $1", policy_id)
            if not policy:
                return None
            riders = await conn.fetch(
                "SELECT * FROM ins_policy_rider WHERE policy_id = $1", policy_id)
            benefits = await conn.fetch(
                "SELECT * FROM ins_policy_benefit WHERE policy_id = $1", policy_id)
            pay_logs = await conn.fetch(
                "SELECT * FROM ins_policy_pay_log WHERE policy_id = $1 ORDER BY pay_time DESC", policy_id)
            underwrite = await conn.fetch(
                "SELECT * FROM ins_policy_underwrite WHERE policy_id = $1 ORDER BY underwrite_time DESC", policy_id)
        return {
            "policy": _row_ready(policy),
            "riders": [_row_ready(r) for r in riders],
            "benefits": [_row_ready(r) for r in benefits],
            "payLogs": [_row_ready(r) for r in pay_logs],
            "underwrite": [_row_ready(r) for r in underwrite],
        }

    async def get_preserve_detail(self, preserve_id: str) -> dict | None:
        async with self._pool.acquire() as conn:
            preserve = await conn.fetchrow(f"{PRESERVE_SELECT} WHERE m.preserve_id = $1", preserve_id)
            if not preserve:
                return None
            details = await conn.fetch(
                "SELECT * FROM ins_preserve_detail WHERE preserve_id = $1", preserve_id)
            fees = await conn.fetch(
                "SELECT * FROM ins_preserve_fee WHERE preserve_id = $1", preserve_id)
            benefits = await conn.fetch(
                "SELECT * FROM ins_preserve_benefit WHERE preserve_id = $1", preserve_id)
            status_changes = await conn.fetch(
                "SELECT * FROM ins_preserve_status WHERE preserve_id = $1 ORDER BY effect_time ASC", preserve_id)
        return {
            "preserve": _row_ready(preserve),
            "details": [_row_ready(r) for r in details],
            "fees": [_row_ready(r) for r in fees],
            "benefits": [_row_ready(r) for r in benefits],
            "statusChanges": [_row_ready(r) for r in status_changes],
        }

    async def get_claim_detail(self, claim_id: str) -> dict | None:
        async with self._pool.acquire() as conn:
            claim = await conn.fetchrow(f"{CLAIM_SELECT} WHERE c.claim_id = $1", claim_id)
            if not claim:
                return None
            payments = await conn.fetch(
                "SELECT * FROM ins_claim_pay WHERE claim_id = $1 ORDER BY pay_time DESC", claim_id)
            audits = await conn.fetch(
                "SELECT * FROM ins_claim_audit WHERE claim_id = $1 ORDER BY audit_time DESC", claim_id)
        return {
            "claim": _row_ready(claim),
            "payments": [_row_ready(r) for r in payments],
            "audits": [_row_ready(r) for r in audits],
        }

    async def export_contract(self, cond: dict) -> str:
        """契约 CSV 导出（UTF-8 BOM），返回 CSV 字符串。"""
        b = ConditionBuilder()
        b.like("p.policy_no", cond.get("policyNo"))
        b.eq("p.product_type", cond.get("productType"))
        b.eq("p.policy_status", cond.get("policyStatus"))
        b.like("c.customer_name", cond.get("applicantName"))
        b.like("i.customer_name", cond.get("insuredName"))
        where = f"WHERE {' AND '.join(b.clauses)}" if b.clauses else ""
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"{CONTRACT_SELECT} {where} ORDER BY p.apply_date DESC LIMIT 5000", *b.params)
        buf = io.StringIO()
        buf.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(buf)
        headers = ["保单号", "险种名称", "状态", "投保人", "被保人", "年交保费", "投保日期", "生效日期", "终止日期"]
        writer.writerow(headers)
        for r in rows:
            writer.writerow([
                r["policy_no"], r["product_name"], r.get("policy_status_label"),
                mask_name(r.get("applicant_name")), mask_name(r.get("insured_name")),
                r["year_premium"], r["apply_date"], r["effect_date"], r["end_date"],
            ])
        return buf.getvalue()

    async def _run_list(self, built: dict, masker, page: int, page_size: int) -> dict:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(built["sql"], *built["params"])
            total_row = await conn.fetchrow(built["count_sql"], *built["count_params"])
        total = total_row["total"] if total_row else 0
        items = [masker(_row_ready(r)) for r in rows]
        return {
            "items": items, "total": total, "page": page, "pageSize": page_size,
            "totalPages": (total + page_size - 1) // page_size if page_size else 0,
        }

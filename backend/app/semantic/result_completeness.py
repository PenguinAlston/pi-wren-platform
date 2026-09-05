"""查询结果完整性自检（直译 TS context/result-completeness.ts）。

对比"用户明确要求的字段"与"查询返回的列"，缺失时触发重查。
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class RequestedField:
    id: str
    label: str


_REQUESTED_FIELD_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    ("policy_no", "保单号码", re.compile(r"保单号|保单号码|保单编号|号码")),
    ("insured_name", "被保人姓名", re.compile(r"被保人|被保险人|姓名")),
]

_COLUMN_ALIASES: dict[str, list[str]] = {
    "policy_no": ["policy_no", "policyno", "policy_number"],
    "insured_name": ["insured_name", "insuredname", "customer_name", "customername"],
}


def requested_fields(question: str) -> list[RequestedField]:
    return [RequestedField(fid, label) for fid, label, pat in _REQUESTED_FIELD_PATTERNS if pat.search(question)]


def missing_requested_fields(question: str, rows: list[dict]) -> list[RequestedField]:
    if not rows:
        return requested_fields(question)
    columns = {k.lower() for k in (rows[0].keys() if rows else [])}
    result: list[RequestedField] = []
    for field in requested_fields(question):
        aliases = _COLUMN_ALIASES.get(field.id, [])
        if not any(alias in columns for alias in aliases):
            result.append(field)
    return result


def build_repair_question(question: str, missing: list[RequestedField]) -> str:
    labels = "、".join(m.label for m in missing)
    return f"{question}（注意：查询结果必须包含 {labels} 等明细字段，请按用户条件查询）"

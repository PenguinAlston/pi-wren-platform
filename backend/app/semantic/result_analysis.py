"""查询结果启发式分析（直译 TS services/agent-runtime/src/tools/result-analysis-tool.ts）。

纯函数、无 LLM、无外部依赖。识别保单明细、时间序列环比、分组占比/排名。
"""
from __future__ import annotations

import re
from typing import Any

from app.models.schemas import BaseModel  # noqa: F401 (占位，实际用 dataclass)


class AnalysisResult:
    """查询结果分析输出。"""

    def __init__(self, summary: str, observations: list[str], table: list[dict[str, Any]]):
        self.summary = summary
        self.observations = observations
        self.table = table


_CODE_LIKE = re.compile(r"(_type|_status|_code|_no|_id|type|status|code|no)$", re.IGNORECASE)
_DETAIL_LINE_LIMIT = 50


def _to_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value if value == value else None  # NaN check
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _is_code_like(name: str) -> bool:
    return bool(_CODE_LIKE.search(name))


def _numeric_columns(rows: list[dict[str, Any]]) -> list[str]:
    cols: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key, value in row.items():
            if key not in seen and not _is_code_like(key) and _to_number(value) is not None:
                seen.add(key)
                cols.append(key)
    return cols


def _is_period_column(name: str) -> bool:
    n = name.lower()
    if re.match(r"^(quarter|month|year|week|date|period|q[1-4]|季度|月份|年份|日期|期间)$", n):
        return True
    if re.match(r"^(20\d{2}|19\d{2})[_-]?q[1-4]$", n):
        return True
    if re.match(r"^\d{4}$", n):
        return True
    if re.match(r"^\d{4}[_-]\d{1,2}$", n):
        return True
    return False


def _find_period_column(row: dict[str, Any]) -> str | None:
    keys = list(row.keys())
    for key in keys:
        if _is_period_column(key):
            return key
    for key in keys:
        if re.match(r"^q[1-4]$", key, re.IGNORECASE):
            return key
    return None


def _format_delta(current: float, previous: float) -> str:
    delta = current - previous
    pct = 0 if previous == 0 else (delta / abs(previous)) * 100
    sign = "+" if delta >= 0 else ""
    pct_sign = "+" if pct >= 0 else ""
    return f"{sign}{delta:.0f} ({pct_sign}{pct:.1f}%)"


def _build_share_observations(
    rows: list[dict[str, Any]], label_column: str, columns: list[str]
) -> list[str]:
    observations: list[str] = []
    for column in columns:
        total = sum(_to_number(row.get(column)) or 0 for row in rows)
        if total == 0:
            continue
        ranked = sorted(
            [{"label": str(row.get(label_column, "未知")), "value": _to_number(row.get(column)) or 0} for row in rows],
            key=lambda x: x["value"],
            reverse=True,
        )
        top = ranked[0] if ranked else None
        second = ranked[1] if len(ranked) > 1 else None
        if top:
            share = (top["value"] / total) * 100
            observations.append(f"{top['label']} 的 {column} 最高（{top['value']:.0f}，占比 {share:.1f}%）")
        if second and second["value"] > 0 and top:
            gap = (top["value"] - second["value"]) / top["value"]
            if gap > 0.5:
                observations.append(
                    f"{top['label']} 的 {column} 显著高于第二名 {second['label']}（高出 {gap * 100:.0f}%）"
                )
    return observations


def _format_policy_detail_rows(rows: list[dict[str, Any]]) -> str | None:
    if not rows:
        return None
    first = rows[0]
    policy_no_key = next(
        (k for k in first if re.match(r"^(policy_no|policyno|policy_number)$", k, re.IGNORECASE)), None
    )
    name_key = next(
        (k for k in first if re.match(r"^(insured_name|customer_name|insuredname|customername)$", k, re.IGNORECASE)),
        None,
    )
    if not policy_no_key or not name_key:
        return None
    lines: list[str] = []
    for row in rows[:_DETAIL_LINE_LIMIT]:
        parts = [f"被保人：{row.get(name_key, '未知')}"]
        if row.get("end_date") is not None:
            parts.append(f"终止日期：{row['end_date']}")
        if row.get("surrender_date") is not None:
            parts.append(f"退保/终止日期：{row['surrender_date']}")
        if row.get("term_type") is not None:
            parts.append(f"口径：{row['term_type']}")
        if row.get("policy_status") is not None:
            parts.append(f"状态：{row['policy_status']}")
        lines.append(f"{row.get(policy_no_key, '?')}（{'，'.join(parts)}）")
    suffix = f"（仅展示前 {_DETAIL_LINE_LIMIT} 条）" if len(rows) > _DETAIL_LINE_LIMIT else ""
    return f"查询返回 {len(rows)} 条保单明细：{'；'.join(lines)}{suffix}"


def analyze_query_result(rows: list[dict[str, Any]], question: str = "") -> AnalysisResult:
    """通用查询结果分析：保单明细 / 时间序列环比 / 分组占比。"""
    if not rows:
        return AnalysisResult("查询未返回任何数据。", [], [])

    detail = _format_policy_detail_rows(rows)
    if detail:
        return AnalysisResult(detail, [detail], rows)

    observations: list[str] = []
    columns = _numeric_columns(rows)
    period_column = _find_period_column(rows[0])

    if period_column and len(rows) > 1:
        for i in range(1, len(rows)):
            current = rows[i]
            previous = rows[i - 1]
            for column in columns:
                cv = _to_number(current.get(column))
                pv = _to_number(previous.get(column))
                if cv is not None and pv is not None:
                    period_label = current.get(period_column, f"row {i + 1}")
                    observations.append(
                        f"{period_label} 相对上一期 {column} 变化：{_format_delta(cv, pv)}"
                    )
    else:
        first = rows[0]
        label_column = (
            next((k for k in first if _is_code_like(k)), None)
            or next((k for k in first if _to_number(first.get(k)) is None), None)
            or "row"
        )
        observations.extend(_build_share_observations(rows, label_column, columns))

    if observations:
        summary = f"查询返回 {len(rows)} 行。{' '.join(observations)}"
    else:
        summary = f"查询返回 {len(rows)} 行，未检测到明显特征。"

    return AnalysisResult(summary, observations, rows)

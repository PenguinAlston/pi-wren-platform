"""评测判定逻辑（纯函数）：对一次 DataAnalysisAgent.answer() 的产出做确定性校验。

run_eval.py 逐案运行后用本模块汇总判定；LLM 评审是可选附加项，由运行器执行后
合入 verdict。全部逻辑无 IO，可独立单测（tests/test_eval_checks.py）。
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

# FROM/JOIN 触达表（带 schema 前缀时取末段表名）
_TABLE_RE = re.compile(r"\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_.]*)", re.IGNORECASE)
# CTE 名（`name AS (`）；列别名不会出现 `AS (`，以此区分
_CTE_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(", re.IGNORECASE)


@dataclass
class CheckItem:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class CaseVerdict:
    case_id: str
    passed: bool
    category: str = ""
    checks: list[CheckItem] = field(default_factory=list)
    sql: str | None = None
    answer: str = ""
    row_count: int = 0
    duration_ms: int = 0
    error: str | None = None
    judge: dict[str, Any] | None = None  # LLM 评审结果（--judge 时合入判定）

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def extract_tables(sql: str | None) -> set[str]:
    """SQL 触达的基础表（小写；剔除 CTE 别名）。评测用启发式，不追求 AST 级精确。"""
    if not sql:
        return set()
    tables = {m.lower().rsplit(".", 1)[-1] for m in _TABLE_RE.findall(sql)}
    ctes = {m.lower() for m in _CTE_RE.findall(sql)}
    return tables - ctes


def check_pipeline(result: Any) -> CheckItem:
    """流水线成功（AgentRunResult.error 为空）。"""
    ok = getattr(result, "error", None) is None
    return CheckItem("pipeline", ok, detail=str(getattr(result, "error", None) or ""))


def check_tables(sql: str | None, expected_tables: list[str]) -> CheckItem:
    """SQL 触达表 ⊆ expectedTables（白名单语义：不必全用到，用到预期外的即失败）。"""
    touched = extract_tables(sql)
    expected = {t.lower() for t in (expected_tables or [])}
    unknown = touched - expected
    ok = not unknown
    return CheckItem("tables", ok, detail="" if ok else f"触达预期外的表: {sorted(unknown)}")


def check_rows(rows: list | None, min_rows: int = 1) -> CheckItem:
    """返回行数下限（默认至少 1 行：评测案例都应查得到数据）。"""
    n = len(rows or [])
    return CheckItem("rows", n >= min_rows, detail=f"{n} 行")


def check_answer_points(answer: str, must_points: list[str]) -> CheckItem | None:
    """答案命中关键点（确定性子串判定；无关键点时返回 None 表示跳过）。"""
    points = [p for p in (must_points or []) if p]
    if not points:
        return None
    missing = [p for p in points if p not in (answer or "")]
    ok = not missing
    return CheckItem("answer_points", ok, detail="" if ok else f"答案未命中关键点: {missing}")


def check_case(case: dict[str, Any], result: Any, *, min_rows: int = 1) -> CaseVerdict:
    """单案例判定聚合：pipeline + tables + rows + answer_points 全部通过才 pass。"""
    checks = [
        check_pipeline(result),
        check_tables(result.sql, case.get("expectedTables") or []),
        check_rows(result.data, min_rows=min_rows),
    ]
    points = check_answer_points(result.answer, case.get("answerMust"))
    if points:
        checks.append(points)
    return CaseVerdict(
        case_id=case["id"],
        passed=all(c.ok for c in checks),
        category=case.get("category", ""),
        checks=checks,
        sql=result.sql,
        answer=result.answer,
        row_count=len(result.data or []),
        duration_ms=getattr(result, "durationMs", 0),
        error=getattr(result, "error", None),
    )

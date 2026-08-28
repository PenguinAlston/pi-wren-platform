"""评测判定逻辑纯函数测试（喂假 result，不依赖真实 DB/LLM/wren）。"""
import json
from pathlib import Path

from app.models.schemas import AgentRunResult
from evals.checks import (
    CaseVerdict,
    check_answer_points,
    check_case,
    check_pipeline,
    check_rows,
    check_tables,
    extract_tables,
)

_CASES_PATH = Path(__file__).resolve().parents[1] / "evals" / "cases" / "insurance.json"


def _result(**overrides) -> AgentRunResult:
    base = {"sessionId": "s-eval", "answer": "结论：赔付率整体稳定。"}
    base.update(overrides)
    return AgentRunResult(**base)


# --- extract_tables ---


def test_extract_tables_basic():
    tables = extract_tables("SELECT * FROM ins_policy_main p JOIN sys_dict d ON 1=1")
    assert tables == {"ins_policy_main", "sys_dict"}


def test_extract_tables_strips_schema_prefix():
    assert extract_tables("SELECT 1 FROM public.ins_claim_main") == {"ins_claim_main"}


def test_extract_tables_excludes_cte_names():
    sql = """
    WITH per_type AS (SELECT product_type FROM ins_policy_main GROUP BY product_type)
    SELECT * FROM per_type
    """
    assert extract_tables(sql) == {"ins_policy_main"}


def test_extract_tables_empty_sql():
    assert extract_tables(None) == set()
    assert extract_tables("") == set()


# --- 单项校验 ---


def test_check_pipeline_ok_and_fail():
    assert check_pipeline(_result()).ok is True
    item = check_pipeline(_result(error="LLM 不可用"))
    assert item.ok is False and "LLM" in item.detail


def test_check_tables_whitelist_semantics():
    # 白名单语义：不必全用到，触达预期外即失败
    assert check_tables("SELECT 1 FROM ins_policy_main", ["ins_policy_main", "sys_dict"]).ok
    bad = check_tables("SELECT 1 FROM ins_policy_main", ["ins_claim_main"])
    assert not bad.ok and "ins_policy_main" in bad.detail


def test_check_rows_min():
    assert check_rows([{"a": 1}]).ok
    assert not check_rows([]).ok
    assert check_rows([], min_rows=0).ok


def test_check_answer_points_none_when_no_points():
    assert check_answer_points("任意回答", []) is None
    # 全是空白关键点等价于无关键点
    assert check_answer_points("任意回答", [None, ""]) is None


def test_check_answer_points_missing():
    item = check_answer_points("整体平稳", ["赔付率"])
    assert not item.ok and "赔付率" in item.detail
    assert check_answer_points("赔付率为 45.00", ["赔付率"]).ok


# --- 聚合判定 ---


def test_check_case_all_pass():
    case = {"id": "c1", "category": "理赔", "expectedTables": ["ins_claim_main"],
            "answerMust": ["赔付率"]}
    result = _result(sql="SELECT 1 FROM ins_claim_main", data=[{"r": "45.00"}],
                     answer="赔付率 45.00", durationMs=1234)
    verdict = check_case(case, result)
    assert isinstance(verdict, CaseVerdict)
    assert verdict.passed and verdict.category == "理赔" and verdict.row_count == 1
    assert verdict.duration_ms == 1234


def test_check_case_fail_aggregates_bad_checks():
    case = {"id": "c2", "expectedTables": ["ins_claim_main"], "answerMust": ["结案"]}
    result = _result(sql="SELECT 1 FROM ins_policy_main", data=[], answer="无数据",
                     error="超时")
    verdict = check_case(case, result)
    assert not verdict.passed
    failed = {c.name for c in verdict.checks if not c.ok}
    assert failed == {"pipeline", "tables", "rows", "answer_points"}


def test_check_case_tables_skipped_without_sql():
    case = {"id": "c3", "expectedTables": []}
    verdict = check_case(case, _result(sql=None, data=[{"x": 1}]))
    assert verdict.passed


# --- 案例库自身完整性（防止案例文件写坏）---


def test_cases_file_valid():
    data = json.loads(_CASES_PATH.read_text(encoding="utf-8"))
    cases = data["cases"]
    assert len(cases) >= 30
    ids = [c["id"] for c in cases]
    assert len(ids) == len(set(ids)), "案例 id 不得重复"
    for c in cases:
        assert c.get("question") and c.get("category")
        assert c.get("expectedTables"), f"{c['id']} 缺 expectedTables"

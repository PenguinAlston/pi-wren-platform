"""result_analysis 测试（直译 TS result-analysis-tool 行为）。"""
from app.semantic.result_analysis import analyze_query_result


def test_empty_rows():
    result = analyze_query_result([])
    assert "未返回任何数据" in result.summary
    assert result.observations == []


def test_policy_detail_rows():
    rows = [
        {"policy_no": "P001", "insured_name": "张三", "end_date": "2025-06-30", "policy_status": "05"},
        {"policy_no": "P002", "insured_name": "李四"},
    ]
    result = analyze_query_result(rows)
    assert "2 条保单明细" in result.summary
    assert "P001" in result.summary
    assert "被保人：张三" in result.summary
    assert "终止日期" in result.summary


def test_period_delta():
    rows = [
        {"quarter": "2024Q1", "revenue": 100},
        {"quarter": "2024Q2", "revenue": 150},
    ]
    result = analyze_query_result(rows)
    assert "2024Q2 相对上一期 revenue 变化" in result.summary
    assert "+50" in result.summary


def test_group_share():
    rows = [
        {"product_type": "01", "policy_count": 8},
        {"product_type": "02", "policy_count": 2},
    ]
    result = analyze_query_result(rows)
    assert "01 的 policy_count 最高" in result.summary
    assert "占比 80.0%" in result.summary


def test_code_like_columns_excluded_from_numeric():
    rows = [{"policy_status": "02", "year_premium": 1000}]
    result = analyze_query_result(rows)
    assert "policy_status 最高" not in result.summary

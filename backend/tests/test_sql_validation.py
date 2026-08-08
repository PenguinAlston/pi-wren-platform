"""sql_validation 测试（直译 TS sql-validation.test.ts 对抗性用例）。"""
import pytest

from app.semantic.sql_validation import extract_sql, parse_and_validate_sql

TABLES = ["ins_policy_main", "ins_claim_main", "sys_dict"]


def test_extracts_sql_from_markdown_code_block():
    assert extract_sql("```sql\nSELECT * FROM ins_policy_main;\n```") == "SELECT * FROM ins_policy_main"


def test_accepts_plain_select_and_with():
    assert "SELECT" in parse_and_validate_sql("SELECT COUNT(*) FROM ins_policy_main", TABLES)
    assert "WITH" in parse_and_validate_sql("WITH t AS (SELECT 1) SELECT * FROM t", TABLES)


def test_allows_joins_to_declared_tables_and_sys_dict():
    sql = parse_and_validate_sql(
        "SELECT d.dict_label FROM ins_claim_main c JOIN sys_dict d ON d.dict_value = c.claim_status", TABLES
    )
    assert "sys_dict" in sql


def test_rejects_data_modifying_statements():
    with pytest.raises(ValueError, match="高危"):
        parse_and_validate_sql("UPDATE ins_policy_main SET year_premium = 0", TABLES)
    with pytest.raises(ValueError, match="高危"):
        parse_and_validate_sql("DELETE FROM ins_policy_main", TABLES)


def test_rejects_multiple_statements():
    with pytest.raises(ValueError):
        parse_and_validate_sql("SELECT 1; DROP TABLE ins_policy_main", TABLES)


def test_rejects_undeclared_tables():
    with pytest.raises(ValueError, match="未声明表"):
        parse_and_validate_sql("SELECT * FROM users", TABLES)


def test_blocks_comment_obfuscated_dml():
    evil = "WITH x AS (DEL/**/ETE FROM ins_policy_main RETURNING *) SELECT * FROM x"
    with pytest.raises(ValueError, match="高危"):
        parse_and_validate_sql(evil, TABLES)
    with pytest.raises(ValueError, match="高危"):
        parse_and_validate_sql("INS/**/ERT INTO ins_policy_main VALUES (1)", TABLES)


def test_blocks_line_comment_obfuscation():
    with pytest.raises(ValueError, match="高危"):
        parse_and_validate_sql("SELECT 1 -- note\nDELETE FROM ins_policy_main", TABLES)


def test_blocks_dangerous_functions():
    with pytest.raises(ValueError, match="危险函数"):
        parse_and_validate_sql("SELECT pg_sleep(3600)", TABLES)
    with pytest.raises(ValueError, match="危险函数"):
        parse_and_validate_sql("SELECT pg_read_file('/etc/passwd')", TABLES)
    with pytest.raises(ValueError, match="危险函数"):
        parse_and_validate_sql("SELECT pg_terminate_backend(42)", TABLES)


def test_allows_keywords_inside_string_literals():
    sql = "SELECT * FROM ins_policy_main WHERE note = 'delete request; drop me'"
    assert parse_and_validate_sql(sql, TABLES) == sql


def test_allows_dollar_quoted_string():
    assert parse_and_validate_sql("SELECT $$delete from ins_policy_main$$", TABLES)


def test_blocks_multi_statement_with_string_semicolon():
    with pytest.raises(ValueError, match="多条"):
        parse_and_validate_sql("SELECT 1; SELECT * FROM ins_policy_main", TABLES)


def test_skips_whitelist_when_tables_absent():
    assert "SELECT" in parse_and_validate_sql("SELECT * FROM any_table", None)
    with pytest.raises(ValueError, match="高危"):
        parse_and_validate_sql("DROP TABLE any_table", None)
    with pytest.raises(ValueError, match="危险函数"):
        parse_and_validate_sql("SELECT pg_sleep(1)", None)


def test_comment_injected_table_not_flagged():
    parse_and_validate_sql("SELECT 1 -- FROM users\n", TABLES)
    with pytest.raises(ValueError, match="未声明表"):
        parse_and_validate_sql("SELECT * FROM users", TABLES)

"""SQL 安全校验（直译 TS services/agent-runtime/src/context/sql-validation.ts）。

所有执行路径的统一关口：剥离 markdown、只读检查、危险函数/关键字拦截、
多语句检测、表名白名单。对抗性测试见 tests/test_sql_validation.py。
"""
from __future__ import annotations

import re

_DANGEROUS_KEYWORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|"
    r"copy|vacuum|execute|call|merge|replace|do|comment)\b",
    re.IGNORECASE,
)

_DANGEROUS_FUNCTIONS = re.compile(
    r"\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|"
    r"pg_write_file|pg_terminate_backend|pg_cancel_backend|pg_advisory_lock|"
    r"pg_advisory_xact_lock|pg_try_advisory_lock|pg_reload_conf|"
    r"pg_rotate_logfile|pg_log_backend_memory_contexts|lo_import|lo_export|"
    r"dblink_connect|dblink_exec|pg_get_functiondef)\b",
    re.IGNORECASE,
)


def _normalize_for_inspection(sql: str) -> str:
    """字符串占位 + 注释剥离，防 DEL/**/ETE、字符串内关键字等绕过。"""
    def _placeholder(m: re.Match) -> str:
        return "'x'" * max(1, (len(m.group(0)) + 2) // 3)

    sql = re.sub(r"\$\$[\s\S]*?\$\$", _placeholder, sql)
    sql = re.sub(r"'([^']|'')*'", _placeholder, sql)
    sql = re.sub(r"/\*[\s\S]*?\*/", "", sql)  # 块注释 → 空串
    sql = re.sub(r"--[^\n]*", " ", sql)  # 行注释 → 空格
    return sql


def extract_sql(raw: str) -> str:
    """从 LLM 原始输出提取 SQL：剥离 markdown 代码块 + 去尾分号。"""
    sql = raw.strip()
    fence = re.match(r"```(?:sql)?\s*([\s\S]*?)```", sql, re.IGNORECASE)
    if fence:
        sql = fence.group(1).strip()
    return re.sub(r";\s*$", "", sql).strip()


def parse_and_validate_sql(
    raw: str,
    allowed_tables: list[str] | None = None,
    max_length: int = 2000,
) -> str:
    """解析并校验 SQL（所有执行路径的统一关口）。"""
    sql = extract_sql(raw)

    if not sql:
        raise ValueError("LLM 返回了空 SQL")
    if len(sql) > max_length:
        raise ValueError(f"LLM 生成的 SQL 过长（{len(sql)} > {max_length}）")

    normalized = _normalize_for_inspection(sql)

    if _DANGEROUS_FUNCTIONS.search(normalized):
        raise ValueError("检测到危险函数调用，已拦截")
    if _DANGEROUS_KEYWORDS.search(normalized):
        raise ValueError("检测到疑似高危/删改语句，已拦截")
    if not re.match(r"^(select|with)\b", normalized, re.IGNORECASE):
        raise ValueError("仅允许 SELECT/WITH 只读查询")
    if ";" in normalized:
        raise ValueError("不允许执行多条语句")

    if not allowed_tables:
        return sql

    clean = normalized.replace('"', "")
    allowed = {t.lower() for t in allowed_tables}
    # CTE 名称放行
    for m in re.finditer(r"\bwith\s+([a-z_][a-z0-9_]*)\s+as\b", clean, re.IGNORECASE):
        allowed.add(m.group(1).lower())

    refs: list[str] = []
    for pattern in [r"\bfrom\s+([a-z_][a-z0-9_.]*)", r"\bjoin\s+([a-z_][a-z0-9_.]*)"]:
        for m in re.finditer(pattern, clean, re.IGNORECASE):
            ref = m.group(1).split(".")[-1].lower()
            if ref:
                refs.append(ref)

    for table in refs:
        if table not in allowed:
            raise ValueError(f"LLM 引用了未声明表：{table}")

    return sql

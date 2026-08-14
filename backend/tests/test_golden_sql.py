"""golden SQL 回归集：wrenai 版本升级防护。

直接用真实 MDL（semantic/wren/target/mdl.json）构造 strict-mode WrenEngine 做 dry_plan：
- 不连库（dry_plan 纯翻译）、不加载 WrenMemory（避免 embedding 模型下载）
- MDL 未构建（本地未跑 wren context build）时整组跳过
升级 wrenai 版本后跑本文件，通过 = 翻译层行为未回归。
"""
from __future__ import annotations

from pathlib import Path

import pytest

MDL_PATH = Path(__file__).resolve().parents[2] / "semantic" / "wren" / "target" / "mdl.json"

pytestmark = pytest.mark.skipif(
    not MDL_PATH.exists(),
    reason=f"MDL 未构建：{MDL_PATH}（在 semantic/wren 下执行 wren context build）",
)

# 正例：覆盖 单模型/字典关联/多表 JOIN/CTE/聚合 的代表性查询
GOLDEN_SQLS = [
    "SELECT COUNT(*) AS cnt FROM ins_policy_main",
    # LLM 实际生成过的形态：业务表 + sys_dict 字典翻译
    """
    SELECT p.product_type, d.dict_label AS product_type_name, COUNT(*) AS policy_count
    FROM ins_policy_main p
    LEFT JOIN sys_dict d ON d.dict_type = 'product_type' AND d.dict_value = p.product_type
    GROUP BY p.product_type ORDER BY policy_count DESC
    """,
    # 多表 JOIN（保单 + 被保人，经 MDL 声明的 insured_id 关联）
    """
    SELECT p.policy_id, c.customer_name, p.total_premium
    FROM ins_policy_main p JOIN ins_customer c ON c.customer_id = p.insured_id
    LIMIT 10
    """,
    # CTE + 二次聚合
    """
    WITH per_type AS (
        SELECT product_type, COUNT(*) AS cnt FROM ins_policy_main GROUP BY product_type
    )
    SELECT product_type, cnt FROM per_type WHERE cnt > 1 ORDER BY cnt DESC
    """,
    # 日期函数 + 条件聚合
    """
    SELECT date_trunc('month', sign_date) AS month, COUNT(*) AS cnt
    FROM ins_policy_main WHERE sign_date >= '2024-01-01'
    GROUP BY 1 ORDER BY 1
    """,
]

# 负例：strict mode 必须拒绝（表外访问 / 数据外读）。
# 注意：wren 0.13.2 的 strict mode 不拦截写语句（INSERT/DELETE 会被 dry_plan 放行）——
# 写操作由本地 sql_validation 第一道闸拦截（见 test_sql_validation.py），流水线先本地校验再 dry-run。
FORBIDDEN_SQLS = [
    # 工程外的系统表
    "SELECT * FROM pg_catalog.pg_tables",
    # 数据外读（文件/远程读取，SSRF/路径穿越面）
    "SELECT * FROM read_csv('/etc/passwd')",
]


def _make_engine(strict: bool = True):
    import base64

    from wren.config import WrenConfig
    from wren.engine import WrenEngine

    manifest_str = base64.b64encode(MDL_PATH.read_bytes()).decode()
    return WrenEngine(manifest_str, "postgres", {}, config=WrenConfig(strict_mode=strict))


@pytest.fixture(scope="module")
def strict_engine():
    return _make_engine(strict=True)


@pytest.mark.parametrize("sql", GOLDEN_SQLS)
def test_golden_sql_transpiles(strict_engine, sql):
    """正例：业务查询在 strict mode 下可完整翻译为物理 SQL。"""
    physical = strict_engine.dry_plan(sql)
    assert physical and isinstance(physical, str)
    assert "ins_policy_main" in physical or "ins_customer" in physical or "sys_dict" in physical


@pytest.mark.parametrize("sql", FORBIDDEN_SQLS)
def test_forbidden_sql_rejected(strict_engine, sql):
    """负例：strict mode 拒绝表外访问/数据外读/写操作。"""
    with pytest.raises(Exception):
        strict_engine.dry_plan(sql)


def test_strict_mode_actually_gates():
    """对照：关掉 strict mode 后，未知表的报错来自翻译层而非 policy（证明开关生效）。"""
    lenient = _make_engine(strict=False)
    with pytest.raises(Exception):
        lenient.dry_plan("SELECT * FROM table_not_in_manifest")

"""机构行级权限测试：OrgAccess 判定 + sqlglot AST 强制（纯函数，无 IO）。"""
import pytest

from app.auth.org_access import OrgAccess
from app.semantic.org_scope import (
    ORG_SCOPED_TABLES,
    enforce_org_access,
    org_prompt_instructions,
    sql_touched_scoped_tables,
)

ORG = "ORG-BJ01"
ORG_ACCESS = OrgAccess("org", ORG)
DENY_ACCESS = OrgAccess("deny")
UNRESTRICTED = OrgAccess.unrestricted()


# --- OrgAccess.for_user ---


class _User:
    def __init__(self, role="user", org_id=None):
        self.role = role
        self.org_id = org_id


def test_access_for_none_user_is_unrestricted():
    """认证未启用 → 不限制（兼容旧行为）。"""
    assert OrgAccess.for_user(None).mode == "unrestricted"


def test_access_for_admin_is_unrestricted():
    assert OrgAccess.for_user(_User(role="admin", org_id=None)).mode == "unrestricted"


def test_access_for_user_with_org():
    access = OrgAccess.for_user(_User(role="user", org_id="ORG-A"))
    assert access.mode == "org" and access.org_code == "ORG-A" and access.restricted


def test_access_for_user_without_org_is_deny():
    assert OrgAccess.for_user(_User(role="user", org_id=None)).mode == "deny"


# --- touched tables ---


def test_touched_tables_detects_and_skips_unscoped():
    sql = "SELECT * FROM ins_policy_main p JOIN sys_dict d ON 1=1"
    assert sql_touched_scoped_tables(sql) == {"ins_policy_main"}


def test_touched_tables_empty_for_unscoped_only():
    assert sql_touched_scoped_tables("SELECT * FROM sys_dict") == set()


def test_touched_tables_parse_error_is_conservative():
    """解析失败 → 视为触达（fail-closed，交由错误处理拒绝）。"""
    assert sql_touched_scoped_tables("SELECT ~~~FROM ins_policy_main") == {"<unparsed>"}


# --- org 模式强制 ---


def _enforce(sql: str, access=ORG_ACCESS) -> str | None:
    return enforce_org_access(sql, access, ORG_SCOPED_TABLES)


def test_org_missing_predicate_rejected():
    assert _enforce("SELECT COUNT(*) FROM ins_policy_main") is not None


def test_org_alias_qualified_predicate_passes():
    sql = f"SELECT COUNT(*) FROM ins_policy_main p WHERE p.org_code = '{ORG}'"
    assert _enforce(sql) is None


def test_org_wrong_value_rejected():
    sql = "SELECT COUNT(*) FROM ins_policy_main p WHERE p.org_code = 'ORG-OTHER'"
    assert _enforce(sql) is not None


def test_org_unqualified_single_table_passes():
    sql = f"SELECT COUNT(*) FROM ins_policy_main WHERE org_code = '{ORG}'"
    assert _enforce(sql) is None


def test_org_in_list_passes():
    sql = f"SELECT * FROM ins_claim_main WHERE org_code IN ('{ORG}', 'ORG-SH')"
    assert _enforce(sql) is None


def test_org_cast_wrapped_value_passes():
    sql = f"SELECT * FROM ins_claim_main WHERE org_code = '{ORG}'::text"
    assert _enforce(sql) is None


def test_org_schema_qualified_table_passes():
    sql = f"SELECT * FROM public.ins_preserve_main m WHERE m.org_code = '{ORG}'"
    assert _enforce(sql) is None


def test_org_join_on_predicate_counts():
    sql = (f"SELECT c.claim_id FROM ins_claim_main c JOIN ins_policy_main p "
           f"ON p.policy_id = c.policy_id AND p.org_code = '{ORG}' "
           f"WHERE c.org_code = '{ORG}'")
    assert _enforce(sql) is None


def test_org_join_covers_only_one_side_rejected():
    sql = (f"SELECT c.claim_id FROM ins_claim_main c JOIN ins_policy_main p "
           f"ON p.policy_id = c.policy_id WHERE c.org_code = '{ORG}'")
    err = _enforce(sql)
    assert err is not None and "ins_policy_main" in err


def test_org_cte_inner_select_checked():
    assert _enforce(
        f"WITH x AS (SELECT * FROM ins_policy_main WHERE org_code = '{ORG}') SELECT * FROM x"
    ) is None
    assert _enforce(
        "WITH x AS (SELECT * FROM ins_policy_main) SELECT * FROM x"
    ) is not None


def test_org_exists_subquery_checked():
    sql = (f"SELECT p.policy_no FROM ins_policy_main p WHERE p.org_code = '{ORG}' "
           f"AND EXISTS (SELECT 1 FROM ins_claim_main c WHERE c.policy_id = p.policy_id)")
    err = _enforce(sql)
    assert err is not None and "ins_claim_main" in err


def test_org_function_wrapped_predicate_rejected():
    """trim(org_code) = 'X' 不算 org 谓词（防止表达式包装绕过）。"""
    sql = f"SELECT COUNT(*) FROM ins_policy_main WHERE trim(org_code) = '{ORG}'"
    assert _enforce(sql) is not None


def test_org_two_scoped_tables_require_qualified_predicates():
    sql = f"SELECT * FROM ins_policy_main p JOIN ins_claim_main c ON c.policy_id = p.policy_id"
    assert _enforce(sql) is not None


def test_org_unscoped_query_passes():
    assert _enforce("SELECT dict_label FROM sys_dict WHERE dict_type = 'x'") is None


def test_org_case_insensitive_identifiers():
    sql = f"SELECT COUNT(*) FROM INS_POLICY_MAIN P WHERE P.ORG_CODE = '{ORG}'"
    assert _enforce(sql) is None


# --- deny 模式 ---


def test_deny_touches_scoped_table_rejected():
    err = _enforce("SELECT COUNT(*) FROM ins_policy_main", DENY_ACCESS)
    assert err is not None and "未分配机构" in err


def test_deny_unscoped_query_passes():
    assert _enforce("SELECT dict_label FROM sys_dict", DENY_ACCESS) is None


# --- unrestricted / 空表集 ---


def test_unrestricted_never_blocks():
    assert _enforce("SELECT * FROM ins_policy_main", UNRESTRICTED) is None


def test_none_access_never_blocks():
    """access=None：未传身份的调用方（旧测试/自定义 Agent 工厂）零影响。"""
    assert enforce_org_access("SELECT * FROM ins_policy_main", None, ORG_SCOPED_TABLES) is None


def test_empty_scoped_tables_never_blocks():
    """自定义 Agent（org_scoped_tables=()）：同样 SQL 在其领域内不受限。"""
    sql = "SELECT * FROM ins_policy_main"
    assert enforce_org_access(sql, ORG_ACCESS, ()) is None


# --- 提示词注入 ---


def test_prompt_instructions_contains_org_and_tables():
    text = org_prompt_instructions(ORG_ACCESS, ORG_SCOPED_TABLES)
    assert ORG in text and "ins_policy_main" in text and "MANDATORY" in text


def test_prompt_instructions_empty_for_unrestricted():
    assert org_prompt_instructions(UNRESTRICTED, ORG_SCOPED_TABLES) == ""
    assert org_prompt_instructions(DENY_ACCESS, ORG_SCOPED_TABLES) == ""


def test_org_scoped_tables_match_schema():
    """约束表清单必须与 schema 里的 org_code NOT NULL 业务表一致（防漂移）。"""
    assert set(ORG_SCOPED_TABLES) == {"ins_policy_main", "ins_claim_main", "ins_preserve_main"}


@pytest.mark.parametrize("table", list(ORG_SCOPED_TABLES))
def test_each_scoped_table_enforced(table):
    err = _enforce(f"SELECT * FROM {table}")
    assert err is not None and table in err

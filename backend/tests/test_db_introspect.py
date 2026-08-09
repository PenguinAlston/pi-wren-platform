"""db_introspect 纯逻辑测试（直译 TS db-introspect.test.ts 行为，含评审修复用例）。

DB 查询部分不测（项目无 DB fixture），纯函数覆盖：类型映射、MDL 组装
（单列 PK / 复合 FK AND / 复合 PK 跳过 / 多 FK 去重 / 删列场景 / 描述 merge）、
描述文本解析。
"""
from app.semantic.db_introspect import build_mdl, map_pg_type, parse_description_map

# ---- map_pg_type ----


def test_map_pg_type_common():
    assert map_pg_type("character varying") == "VARCHAR"
    assert map_pg_type("numeric") == "DECIMAL"
    assert map_pg_type("timestamp without time zone") == "TIMESTAMP"
    assert map_pg_type("boolean") == "BOOLEAN"
    assert map_pg_type("uuid") == "UUID"


def test_map_pg_type_unknown_uppercases():
    assert map_pg_type("some_future_type") == "SOME_FUTURE_TYPE"


# ---- build_mdl ----

_RAW = {
    "tables": [{"table_name": "hr_employee"}, {"table_name": "hr_department"}],
    "columns": [
        {"table_name": "hr_employee", "column_name": "emp_id", "data_type": "character varying"},
        {"table_name": "hr_employee", "column_name": "dept_id", "data_type": "integer"},
        {"table_name": "hr_employee", "column_name": "hire_date", "data_type": "timestamp without time zone"},
        {"table_name": "hr_department", "column_name": "dept_id", "data_type": "integer"},
        {"table_name": "hr_department", "column_name": "dept_name", "data_type": "character varying"},
    ],
    "constraints": [
        {"table_name": "hr_employee", "contype": "p", "conname": "hr_employee_pkey", "col_names": ["emp_id"], "ref_table": None, "ref_col_names": None},
        {"table_name": "hr_department", "contype": "p", "conname": "hr_department_pkey", "col_names": ["dept_id"], "ref_table": None, "ref_col_names": None},
        {"table_name": "hr_employee", "contype": "f", "conname": "hr_employee_dept_fk", "col_names": ["dept_id"], "ref_table": "hr_department", "ref_col_names": ["dept_id"]},
    ],
}


def _find(models, name):
    return next(m for m in models if m["name"] == name)


def test_build_mdl_column_types():
    m = build_mdl(_RAW, "public")
    emp = _find(m["models"], "hr_employee")
    assert [c["type"] for c in emp["columns"]] == ["VARCHAR", "INTEGER", "TIMESTAMP"]
    assert emp["tableReference"] == {"schema": "public", "table": "hr_employee"}


def test_build_mdl_single_column_pk():
    m = build_mdl(_RAW, "public")
    assert _find(m["models"], "hr_employee")["primaryKey"] == "emp_id"
    assert _find(m["models"], "hr_department")["primaryKey"] == "dept_id"


def test_build_mdl_relationship_many_to_one():
    m = build_mdl(_RAW, "public")
    assert m["relationships"] == [{
        "name": "hr_employee_hr_department",
        "models": ["hr_employee", "hr_department"],
        "joinType": "MANY_TO_ONE",
        "condition": "hr_employee.dept_id = hr_department.dept_id",
    }]


def test_build_mdl_drops_fk_to_missing_table():
    raw = {
        **_RAW,
        "constraints": _RAW["constraints"] + [
            {"table_name": "hr_employee", "contype": "f", "conname": "orphan_fk", "col_names": ["dept_id"], "ref_table": "missing_table", "ref_col_names": ["dept_id"]},
        ],
    }
    m = build_mdl(raw, "public")
    assert [r["name"] for r in m["relationships"]] == ["hr_employee_hr_department"]


def test_build_mdl_merges_descriptions():
    m = build_mdl(_RAW, "public", {
        "models": {"hr_employee": {"description": "员工主表",
                                   "columns": {"emp_id": "工号", "hire_date": "入职时间"}}},
    })
    emp = _find(m["models"], "hr_employee")
    assert emp["properties"]["description"] == "员工主表"
    cols = {c["name"]: c for c in emp["columns"]}
    assert cols["emp_id"]["properties"]["description"] == "工号"
    assert cols["hire_date"]["properties"]["description"] == "入职时间"
    assert "properties" not in cols["dept_id"]  # 未提供描述的列不带 properties


def test_build_mdl_envelope_fixed():
    m = build_mdl(_RAW, "public", {}, catalog="hr")
    assert m["catalog"] == "hr"
    assert m["schema"] == "public"
    assert m["dataSource"] == "postgres"
    assert m["layoutVersion"] == 3
    assert m["views"] == [] and m["cubes"] == []


def test_build_mdl_no_pk_constraint():
    raw = {"tables": _RAW["tables"], "columns": _RAW["columns"], "constraints": []}
    m = build_mdl(raw, "public")
    assert all("primaryKey" not in mod for mod in m["models"])


def test_build_mdl_composite_fk_with_and():
    """复合外键 (a,b)→(x,y) 用 AND 连接，保持列对顺序。"""
    raw = {
        "tables": [{"table_name": "t"}, {"table_name": "r"}],
        "columns": [
            {"table_name": "t", "column_name": "a", "data_type": "integer"},
            {"table_name": "t", "column_name": "b", "data_type": "integer"},
            {"table_name": "r", "column_name": "x", "data_type": "integer"},
            {"table_name": "r", "column_name": "y", "data_type": "integer"},
        ],
        "constraints": [
            {"table_name": "t", "contype": "f", "conname": "t_r_fk", "col_names": ["a", "b"], "ref_table": "r", "ref_col_names": ["x", "y"]},
        ],
    }
    m = build_mdl(raw, "public")
    assert len(m["relationships"]) == 1
    assert m["relationships"][0]["condition"] == "t.a = r.x AND t.b = r.y"


def test_build_mdl_composite_pk_omitted():
    """复合主键 MDL 只支持单列，复合主键跳过 primaryKey。"""
    raw = {
        "tables": [{"table_name": "junction"}],
        "columns": [
            {"table_name": "junction", "column_name": "k1", "data_type": "integer"},
            {"table_name": "junction", "column_name": "k2", "data_type": "integer"},
        ],
        "constraints": [{"table_name": "junction", "contype": "p", "conname": "j_pkey", "col_names": ["k1", "k2"], "ref_table": None, "ref_col_names": None}],
    }
    m = build_mdl(raw, "public")
    assert "primaryKey" not in m["models"][0]


def test_build_mdl_dedup_relationship_names_multi_fk():
    """orders 通过 bill_*/ship_* 都指向 customers，relationship 名称必须唯一。"""
    raw = {
        "tables": [{"table_name": "orders"}, {"table_name": "customers"}],
        "columns": [
            {"table_name": "orders", "column_name": "id", "data_type": "integer"},
            {"table_name": "orders", "column_name": "bill_customer_id", "data_type": "integer"},
            {"table_name": "orders", "column_name": "ship_customer_id", "data_type": "integer"},
            {"table_name": "customers", "column_name": "id", "data_type": "integer"},
        ],
        "constraints": [
            {"table_name": "orders", "contype": "f", "conname": "orders_bill_fk", "col_names": ["bill_customer_id"], "ref_table": "customers", "ref_col_names": ["id"]},
            {"table_name": "orders", "contype": "f", "conname": "orders_ship_fk", "col_names": ["ship_customer_id"], "ref_table": "customers", "ref_col_names": ["id"]},
        ],
    }
    m = build_mdl(raw, "public")
    names = [r["name"] for r in m["relationships"]]
    assert len(names) == len(set(names))  # 全局唯一
    assert "orders_customers" in names
    conds = [r["condition"] for r in m["relationships"]]
    assert any("bill_customer_id" in c for c in conds)
    assert any("ship_customer_id" in c for c in conds)


def test_build_mdl_pk_from_column_names_not_ordinal():
    """删过列的表：约束返回的列名（由 pg_attribute join 得到）不受 ordinal_position 影响。"""
    raw = {
        "tables": [{"table_name": "t"}],
        "columns": [
            {"table_name": "t", "column_name": "first", "data_type": "integer"},
            {"table_name": "t", "column_name": "third", "data_type": "integer"},
        ],
        # 主键在 'third' 列（attnum=3，被删的 attnum=2 不出现），直接用约束返回的列名
        "constraints": [{"table_name": "t", "contype": "p", "conname": "t_pkey", "col_names": ["third"], "ref_table": None, "ref_col_names": None}],
    }
    m = build_mdl(raw, "public")
    assert m["models"][0]["primaryKey"] == "third"


def test_build_mdl_handles_asyncpg_bytes_contype():
    """真实库回归：asyncpg 把 pg_constraint.contype（Postgres char）返回为 bytes（b'p'/b'f'），
    col_names 返回为 list。必须能正确识别 PK/FK，否则全部丢失。"""
    raw = {
        "tables": [{"table_name": "employee"}, {"table_name": "department"}],
        "columns": [
            {"table_name": "employee", "column_name": "emp_id", "data_type": "character varying"},
            {"table_name": "employee", "column_name": "dept_id", "data_type": "integer"},
            {"table_name": "department", "column_name": "dept_id", "data_type": "integer"},
        ],
        # 模拟 asyncpg 真实返回：contype 是 bytes，col_names/ref_col_names 是 list
        "constraints": [
            {"table_name": "employee", "contype": b"p", "conname": "emp_pkey",
             "col_names": ["emp_id"], "ref_table": None, "ref_col_names": None},
            {"table_name": "department", "contype": b"p", "conname": "dept_pkey",
             "col_names": ["dept_id"], "ref_table": None, "ref_col_names": None},
            {"table_name": "employee", "contype": b"f", "conname": "emp_dept_fk",
             "col_names": ["dept_id"], "ref_table": "department", "ref_col_names": ["dept_id"]},
        ],
    }
    m = build_mdl(raw, "public")
    # bytes contype 也能识别 PK
    assert _find(m["models"], "employee")["primaryKey"] == "emp_id"
    assert _find(m["models"], "department")["primaryKey"] == "dept_id"
    # bytes contype 也能识别 FK
    assert len(m["relationships"]) == 1
    assert m["relationships"][0]["condition"] == "employee.dept_id = department.dept_id"


# ---- parse_description_map ----

def test_parse_description_map_json():
    text = '{"models": {"t": {"description": "表", "columns": {"a": "列"}}}}'
    assert parse_description_map(text) == {"models": {"t": {"description": "表", "columns": {"a": "列"}}}}


def test_parse_description_map_yaml():
    text = "models:\n  t:\n    description: 表\n    columns:\n      a: 列"
    assert parse_description_map(text) == {"models": {"t": {"description": "表", "columns": {"a": "列"}}}}


def test_parse_description_map_bare_form():
    # 不带 models 包裹，直接 { 表名: {...} }
    text = '{"t": {"description": "表"}}'
    assert parse_description_map(text) == {"models": {"t": {"description": "表"}}}


def test_parse_description_map_empty():
    assert parse_description_map("") == {}
    assert parse_description_map(None) == {}
    assert parse_description_map("   ") == {}


def test_parse_description_map_invalid():
    assert parse_description_map("{not valid json") == {}
    assert parse_description_map("just a string") == {}

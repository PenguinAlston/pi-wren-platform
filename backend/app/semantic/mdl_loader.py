"""MDL 工具函数：提取表名白名单（对应 TS project-loader.ts 的 allowedTablesOf）。"""
from __future__ import annotations

import json
from pathlib import Path


def load_allowed_tables(mdl_path: Path) -> list[str]:
    """从 target/mdl.json 提取所有模型的物理表名（小写）+ sys_dict。"""
    if not mdl_path.exists():
        return ["sys_dict"]
    with open(mdl_path, encoding="utf-8") as f:
        manifest = json.load(f)
    tables: list[str] = []
    for model in manifest.get("models", []):
        ref = model.get("tableReference", {})
        table = ref.get("table") or model.get("name", "")
        if table:
            tables.append(table.lower())
    tables.append("sys_dict")
    return tables

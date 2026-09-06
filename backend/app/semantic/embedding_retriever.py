"""远程 embedding 语义检索：替代本地 WrenMemory（服务器小内存部署用）。

- 知识块：语义工程的表/列（MDL 每表一块）+ knowledge/sql 业务查询示例
- 向量经 OpenAI 兼容 /embeddings API 计算（DashScope text-embedding-v3 等），
  进程内常驻（几十个块仅几百 KB），查询时余弦相似度取 top-k
- embed_fn 可注入（测试用伪函数）；任何失败由调用方降级到 MDL 直读
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

import httpx

_BATCH_SIZE = 10  # DashScope text-embedding-v3 单请求上限


def build_chunks(project_dir: Path, manifest: dict) -> list[dict]:
    """从 MDL 与 knowledge/sql 构建知识块。块：{kind, name, text}。"""
    chunks: list[dict] = []
    for model in manifest.get("models", []):
        name = model.get("name", "")
        if not name:
            continue
        desc = (model.get("description") or "").strip()
        columns = [
            f"{c.get('name')}({c.get('type', '')})"
            for c in model.get("columns", []) if c.get("name")
        ]
        text = f"表 {name}" + (f"：{desc}" if desc else "")
        text += f"\n字段：{', '.join(columns)}"
        chunks.append({"kind": "table", "name": name, "text": text})

    sql_dir = Path(project_dir) / "knowledge" / "sql"
    if sql_dir.exists():
        for md in sorted(sql_dir.glob("*.md")):
            body = md.read_text(encoding="utf-8").strip()
            if body:
                chunks.append({"kind": "sql", "name": md.stem, "text": body})
    return chunks


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class EmbeddingRetriever:
    """远程 embedding 语义检索器：表块 + SQL 示例块的向量检索。"""

    def __init__(self, project_dir: Path, manifest: dict, api_base: str,
                 api_key: str, model: str, embed_fn=None):
        self._api_base = api_base.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._embed_fn = embed_fn or self._remote_embed
        self._chunks = build_chunks(project_dir, manifest)
        self._vectors: list[list[float]] | None = None  # 懒加载：首次检索时批量计算

    # --- 向量计算 ---
    def _remote_embed(self, texts: list[str]) -> list[list[float]]:
        """OpenAI 兼容 /embeddings 调用；自动分批（DashScope 单请求 ≤10 条）。"""
        vectors: list[list[float]] = []
        with httpx.Client(timeout=20) as client:
            for i in range(0, len(texts), _BATCH_SIZE):
                batch = texts[i:i + _BATCH_SIZE]
                resp = client.post(
                    f"{self._api_base}/embeddings",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={"model": self._model, "input": batch},
                )
                resp.raise_for_status()
                data = sorted(resp.json()["data"], key=lambda d: d["index"])
                vectors.extend(item["embedding"] for item in data)
        return vectors

    def _ensure_vectors(self) -> None:
        if self._vectors is None:
            self._vectors = self._embed_fn([c["text"] for c in self._chunks])

    def _embed_query(self, query: str) -> list[float]:
        return self._embed_fn([query])[0]

    # --- 检索 ---
    def search(self, query: str, top_tables: int = 6, top_sql: int = 3) -> str:
        """返回注入 LLM 的语义上下文：相关表（全字段）+ 相似 SQL 示例。"""
        self._ensure_vectors()
        qvec = self._embed_query(query)
        scored = [
            (cosine(qvec, vec), chunk)
            for chunk, vec in zip(self._chunks, self._vectors)
        ]

        scored_all = sorted(scored, key=lambda pair: pair[0], reverse=True)
        tables = [chunk for score, chunk in scored_all
                  if chunk["kind"] == "table"][:top_tables]
        sqls = [chunk for score, chunk in scored_all
                if chunk["kind"] == "sql"][:top_sql]

        parts: list[str] = ["相关表："] + [c["text"] for c in tables]
        if sqls:
            parts.append("相似业务查询示例（口径参考）：")
            parts.extend(c["text"] for c in sqls)
        return "\n".join(parts)

"""embedding_retriever 纯函数测试：分块 / 余弦排序 / 上下文格式化（embed 注入伪函数）。"""
from pathlib import Path

from app.semantic.embedding_retriever import EmbeddingRetriever, build_chunks, cosine

MANIFEST = {
    "models": [
        {"name": "ins_policy_main", "description": "保单主表",
         "columns": [{"name": "policy_no", "type": "varchar"}, {"name": "year_premium", "type": "decimal"}]},
        {"name": "ins_claim_main", "description": "理赔主表",
         "columns": [{"name": "claim_no", "type": "varchar"}]},
        {"name": "sys_dict", "description": "字典表", "columns": []},
    ]
}


def _fake_embed(dims_per_keyword: dict[str, list[float]]):
    """伪 embed：文本包含某关键词则返回对应向量，否则零向量。"""
    def embed(texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            vec = [0.0] * 4
            for keyword, kv in dims_per_keyword.items():
                if keyword in text:
                    for i, v in enumerate(kv):
                        vec[i] += v
            vectors.append(vec)
        return vectors
    return embed


def _make_retriever(tmp_path: Path) -> EmbeddingRetriever:
    sql_dir = tmp_path / "knowledge" / "sql"
    sql_dir.mkdir(parents=True)
    (sql_dir / "premium.md").write_text("各险种保费规模：SELECT product_type, SUM(year_premium) FROM ins_policy_main GROUP BY product_type", encoding="utf-8")
    (sql_dir / "claim.md").write_text("理赔统计：SELECT claim_status, COUNT(*) FROM ins_claim_main GROUP BY claim_status", encoding="utf-8")
    # 伪向量空间：[保费, 理赔, 保单主体, 字典]
    return EmbeddingRetriever(
        tmp_path, MANIFEST,
        api_base="http://fake", api_key="k", model="fake-model",
        embed_fn=_fake_embed({"保费": [1, 0, 0, 0], "理赔": [0, 1, 0, 0],
                              "保单": [0, 0, 1, 0], "字典": [0, 0, 0, 1]}),
    )


def test_build_chunks_kinds():
    chunks = build_chunks(Path("/nonexistent"), MANIFEST)
    tables = [c for c in chunks if c["kind"] == "table"]
    assert len(tables) == 3
    policy = next(c for c in tables if c["name"] == "ins_policy_main")
    assert "保单主表" in policy["text"]
    assert "year_premium(decimal)" in policy["text"]
    # knowledge/sql 目录不存在时不产生 sql 块
    assert not [c for c in chunks if c["kind"] == "sql"]


def test_cosine_directional():
    assert cosine([1, 0], [1, 0]) == 1.0
    assert cosine([1, 0], [0, 1]) == 0.0
    assert cosine([0, 0], [1, 1]) == 0.0


def test_search_ranks_relevant_table_first(tmp_path):
    retriever = _make_retriever(tmp_path)
    context = retriever.search("各险种的保费规模")
    # 保费相关：ins_policy_main 排最前，且带出保费 SQL 示例
    assert context.index("ins_policy_main") < context.index("ins_claim_main")
    assert "相似业务查询示例" in context
    assert "SUM(year_premium)" in context


def test_search_claim_query(tmp_path):
    retriever = _make_retriever(tmp_path)
    context = retriever.search("理赔案件进度")
    assert context.index("ins_claim_main") < context.index("ins_policy_main")


def test_search_empty_query_falls_back(tmp_path):
    retriever = _make_retriever(tmp_path)
    # 全零向量：所有得分相同 → 不抛错且返回完整表清单
    context = retriever.search("无匹配关键词的问题")
    assert "ins_policy_main" in context

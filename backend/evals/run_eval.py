"""NL→SQL 评测运行器（效果闭环 · 手动执行，不进默认 pytest/CI）。

前置条件：
  - 真实 PostgreSQL（infra/postgres 初始化脚本已执行）
  - OPENAI_* 配置可用（.env）
  - semantic/wren 已执行 `wren context build`（target/mdl.json 存在）

评测真实调用 DataAnalysisAgent.answer() 全链路（语义检索 → LLM 生成 SQL →
本地校验 → wren dry-run → 执行 → 分析 → LLM 摘要）。agent 不挂 memory（memory=None），
不产生会话写入，对业务库只产生只读查询。

用法（backend/ 内）：
    python -m evals.run_eval                  # 全量
    python -m evals.run_eval --only claim_*   # 按案例 id 过滤（fnmatch）
    python -m evals.run_eval --judge          # 附加 LLM 答案评审（评审不通过即失败）
    python -m evals.run_eval --list           # 仅列出案例

产出：终端汇总 + evals/reports/eval-<时间戳>.json；存在失败案例时退出码 1。
"""
from __future__ import annotations

import argparse
import asyncio
import fnmatch
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from evals.checks import CaseVerdict, check_case

CASES_PATH = Path(__file__).resolve().parent / "cases" / "insurance.json"
REPORTS_DIR = Path(__file__).resolve().parent / "reports"

JUDGE_SYSTEM_PROMPT = (
    "你是严格的问答质量评审员。对比【用户问题】【助手回答】【必须命中的关键点】，判定：\n"
    "1) 回答是否覆盖全部关键点；2) 回答中的数值或结论是否可疑编造（与查询语境无关、自相矛盾）。\n"
    '只输出一个 JSON 对象，不要其他文字：'
    '{"pass": true或false, "missing": ["缺失的关键点"], "fabricated": "编造描述或空字符串"}'
)


def load_cases() -> list[dict[str, Any]]:
    with open(CASES_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data["cases"]


async def judge_answer(llm: Any, case: dict[str, Any], answer: str) -> dict[str, Any]:
    """LLM 评审：关键点覆盖 + 编造检测。输出不可解析时按失败处理（fail-closed）。"""
    user_content = (
        f"【用户问题】{case['question']}\n\n"
        f"【助手回答】\n{answer}\n\n"
        f"【必须命中的关键点】{json.dumps(case.get('answerMust') or [], ensure_ascii=False)}"
    )
    resp = await llm.ainvoke([
        {"role": "system", "content": JUDGE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ])
    match = re.search(r"\{[\s\S]*\}", resp.content or "")
    if not match:
        return {"pass": False, "missing": [], "fabricated": f"评审输出不可解析: {(resp.content or '')[:200]}"}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"pass": False, "missing": [], "fabricated": f"评审 JSON 解析失败: {match.group(0)[:200]}"}
    return {
        "pass": bool(data.get("pass")),
        "missing": [str(m) for m in (data.get("missing") or [])],
        "fabricated": str(data.get("fabricated") or ""),
    }


def print_summary(verdicts: list[CaseVerdict], elapsed_s: float) -> None:
    passed = sum(1 for v in verdicts if v.passed)
    print("\n" + "=" * 72)
    print(f"评测完成：{passed}/{len(verdicts)} 通过（{passed / len(verdicts) * 100:.1f}%）· 总耗时 {elapsed_s:.0f}s")
    by_category: dict[str, list[CaseVerdict]] = defaultdict(list)
    for v in verdicts:
        by_category[v.category].append(v)
    for cat, items in sorted(by_category.items()):
        cat_passed = sum(1 for v in items if v.passed)
        print(f"  {cat}: {cat_passed}/{len(items)}")
    failures = [v for v in verdicts if not v.passed]
    if failures:
        print("-" * 72)
        for v in failures:
            bad = [f"{c.name}({c.detail})" for c in v.checks if not c.ok]
            if v.judge and not v.judge.get("pass"):
                bad.append(f"judge(missing={v.judge.get('missing')}, fabricated={v.judge.get('fabricated')})")
            print(f"  FAIL {v.case_id}: {', '.join(bad)}")
    print("=" * 72)


def write_report(verdicts: list[CaseVerdict], args: argparse.Namespace, elapsed_s: float) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for v in verdicts if v.passed)
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "args": {"only": args.only, "judge": args.judge},
        "total": len(verdicts),
        "passed": passed,
        "passRate": round(passed / len(verdicts) * 100, 1) if verdicts else 0.0,
        "elapsedSeconds": round(elapsed_s, 1),
        "cases": [v.to_json() for v in verdicts],
    }
    path = REPORTS_DIR / f"eval-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


async def run(args: argparse.Namespace) -> int:
    from app.agents.data_analysis import DataAnalysisAgent
    from app.agents.domain import insurance_domain
    from app.config import get_settings
    from app.llm import build_llm
    from app.semantic.mdl_loader import load_allowed_tables
    from app.semantic.wren_engine import WrenEngineService

    settings = get_settings()
    cases = load_cases()
    if args.only:
        cases = [c for c in cases if fnmatch.fnmatch(c["id"], args.only)]
    if not cases:
        print(f"[错误] 过滤条件未命中任何案例: {args.only}")
        return 2
    if args.list:
        for c in cases:
            print(f"{c['id']:36s} [{c['category']}] {c['question']}")
        print(f"\n共 {len(cases)} 条案例")
        return 0

    mdl_path = settings.wren_project_path / "target" / "mdl.json"
    if not mdl_path.exists():
        print(f"[环境错误] MDL 未构建：{mdl_path}（在 semantic/wren 下执行 wren context build）")
        return 2
    if not settings.OPENAI_API_KEY:
        print("[环境错误] 未配置 OPENAI_API_KEY（评测需真实 LLM）")
        return 2

    engine = WrenEngineService(settings)
    allowed_tables = load_allowed_tables(mdl_path)
    llm = build_llm(settings)
    # memory=None：评测不落会话，多轮历史注入自然为空（案例均为单轮）
    agent = DataAnalysisAgent(insurance_domain, engine, llm, allowed_tables, memory=None)

    verdicts: list[CaseVerdict] = []
    started = time.time()
    for i, case in enumerate(cases, 1):
        t0 = time.time()
        result = await agent.answer(case["question"])
        verdict = check_case(case, result)
        if args.judge and result.error is None:
            verdict.judge = await judge_answer(llm, case, result.answer)
            verdict.passed = verdict.passed and verdict.judge["pass"]
        status = "PASS" if verdict.passed else "FAIL"
        print(f"[{i}/{len(cases)}] {status} {verdict.case_id} "
              f"({time.time() - t0:.0f}s, {verdict.row_count} 行)")
        verdicts.append(verdict)

    elapsed = time.time() - started
    print_summary(verdicts, elapsed)
    report = write_report(verdicts, args, elapsed)
    print(f"报告已写入: {report}")
    return 0 if all(v.passed for v in verdicts) else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="NL→SQL 评测回归集运行器")
    parser.add_argument("--only", help="按案例 id 过滤（fnmatch，如 claim_*）")
    parser.add_argument("--judge", action="store_true", help="附加 LLM 答案评审（评审不通过即失败）")
    parser.add_argument("--list", action="store_true", help="仅列出案例，不运行")
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()

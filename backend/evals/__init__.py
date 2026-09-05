"""NL→SQL 评测回归集（效果闭环）。

cases/ 案例库 + checks.py 纯函数判定 + run_eval.py 运行器。
真实调用 DataAnalysisAgent 全链路，不进默认 pytest/CI（需真实 DB/LLM/MDL）。
"""

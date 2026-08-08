"""数据分析 Agent（对应 TS DataAnalysisAgent，Python 重构版）。

确定性流水线（保留 TS 版的固定编排，不引入 LLM 自由循环）：
  问题 → wren 语义检索 → LLM 生成 SQL → wren dry-run 校验 → 执行 → 完整性自检 → 分析 → LLM 摘要

关键改进（相对 TS 版）：
  - WrenEngine 进程内调用（无 execFile 子进程），消除参数解析 bug
  - dry-run 失败/LLM 幻觉时带提示重试（最多 2 次）
  - 表名白名单来自 WrenAI 工程的 MDL models
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

from langchain_openai import ChatOpenAI
from loguru import logger

from app.agents.domain import AgentDomainConfig, SQL_SYSTEM_PROMPT
from app.models.schemas import AgentEvent, AgentRunResult, AgentToolCall
from app.semantic.result_analysis import analyze_query_result
from app.semantic.result_completeness import (
    build_repair_question,
    missing_requested_fields,
)
from app.semantic.sql_validation import extract_sql, parse_and_validate_sql
from app.semantic.wren_engine import WrenEngineService

_HISTORY_INJECTION_TURNS = 3
_MAX_SQL_REGEN_ATTEMPTS = 2
_MAX_REPAIR_ATTEMPTS = 1


class DataAnalysisAgent:
    """通用数据分析 Agent：领域无关，差异由 domain 配置 + 注入的语义层决定。"""

    def __init__(
        self,
        domain: AgentDomainConfig,
        engine: WrenEngineService,
        llm: ChatOpenAI,
        allowed_tables: list[str],
        memory: Any = None,  # JsonlSessionStore（阶段 4 实现）
    ):
        self._domain = domain
        self._engine = engine
        self._llm = llm
        self._allowed_tables = allowed_tables
        self._memory = memory

    @property
    def domain(self) -> AgentDomainConfig:
        return self._domain

    async def answer(
        self,
        question: str,
        *,
        session_id: str | None = None,
        on_event=None,
    ) -> AgentRunResult:
        started = time.time()
        sid = session_id or str(uuid.uuid4())
        events: list[AgentEvent] = []
        trace: list[str] = []
        tool_calls: list[AgentToolCall] = []

        history = await self._load_history(sid, question)

        def emit(event_type: str, label: str, detail: str | None = None):
            from datetime import datetime, timezone

            event = AgentEvent(
                id=str(uuid.uuid4()),
                type=event_type,
                label=label,
                detail=detail,
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
            events.append(event)
            trace.append(label)
            if on_event:
                on_event(event)
            return event

        def make_event(event_type: str, label: str, detail: str | None = None) -> AgentEvent:
            from datetime import datetime, timezone

            return AgentEvent(
                id=str(uuid.uuid4()),
                type=event_type,
                label=label,
                detail=detail,
                timestamp=datetime.now(timezone.utc).isoformat(),
            )

        try:
            emit("plan", "理解业务问题", question)

            async def run_query(target_question: str, call_label: str):
                """一次"生成 SQL → 校验 → 执行"往返，失败带提示重试。"""
                last_error: str | None = None
                for attempt in range(_MAX_SQL_REGEN_ATTEMPTS + 1):
                    prompt = (
                        target_question
                        if attempt == 0 or not last_error
                        else f"{target_question}\n\n注意：上次生成失败（{last_error}），"
                        "请严格只使用已声明的表，重新生成只读 SQL，不要用 markdown 代码块包裹。"
                    )
                    try:
                        # ① wren 语义检索
                        ctx_text = await asyncio.to_thread(self._engine.fetch_context, prompt)
                        instructions = await asyncio.to_thread(self._engine.fetch_instructions)
                        # ② LLM 生成 SQL
                        sql_start = time.time()
                        sql = await self._generate_sql(prompt, ctx_text, instructions, history)
                        tool_calls.append(AgentToolCall(
                            name="wren_generate_sql", input=prompt, output=sql,
                            durationMs=int((time.time() - sql_start) * 1000), ok=True,
                        ))
                        emit("tool_call", call_label if attempt == 0 else f"{call_label}（重试）", sql)

                        # ③ 本地白名单校验
                        validated = parse_and_validate_sql(sql, self._allowed_tables)

                        # ④ wren dry-run 受治理校验
                        ok, err = await asyncio.to_thread(self._engine.dry_run, validated)
                        if not ok:
                            raise ValueError(f"wren dry-run rejected sql: {err}")

                        # ⑤ 执行
                        query_start = time.time()
                        rows = await asyncio.to_thread(self._engine.query, validated)
                        tool_calls.append(AgentToolCall(
                            name="database_query", input=validated,
                            output={"rows": len(rows)}, durationMs=int((time.time() - query_start) * 1000), ok=True,
                        ))
                        emit("tool_result", f"查询执行完成，返回 {len(rows)} 行")
                        return {"sql": validated, "rows": rows}

                    except Exception as e:
                        last_error = str(e)
                        if attempt < _MAX_SQL_REGEN_ATTEMPTS:
                            emit("observation", "SQL 生成失败，重新生成", last_error)
                            continue
                raise RuntimeError(last_error or "SQL 生成失败")

            result = await run_query(question, "通过语义层生成 SQL")
            sql = result["sql"]
            rows = result["rows"]

            # 结果完整性自检
            missing = missing_requested_fields(question, rows)
            for attempt in range(_MAX_REPAIR_ATTEMPTS):
                if not missing:
                    break
                labels = "、".join(m.label for m in missing)
                emit("observation", "检查结果完整性", f"缺少字段：{labels}，重新生成 SQL")
                result = await run_query(build_repair_question(question, missing), "补齐字段后重新生成 SQL")
                sql = result["sql"]
                rows = result["rows"]
                missing = missing_requested_fields(question, rows)

            # 启发式分析
            analysis = analyze_query_result(rows, question)
            if missing:
                labels = "、".join(m.label for m in missing)
                note = f"本次查询结果仍缺少用户要求的字段：{labels}。"
                analysis.observations.append(note)
                analysis.summary = f"{analysis.summary} {note}"
            tool_calls.append(AgentToolCall(
                name="result_analysis", input={"rows": len(rows)},
                output=analysis.summary, durationMs=0, ok=True,
            ))
            emit("observation", "分析查询结果", analysis.summary)

            # LLM 摘要
            answer_text = analysis.summary
            summary_start = time.time()
            try:
                llm_answer = await self._summarize(question, analysis, history)
                if llm_answer and llm_answer.strip():
                    answer_text = llm_answer
                else:
                    logger.warning("LLM 摘要返回空，使用确定性分析")
                tool_calls.append(AgentToolCall(
                    name="llm_summarize", input={"question": question, "historyTurns": len(history)},
                    output={"chars": len(answer_text)}, durationMs=int((time.time() - summary_start) * 1000), ok=True,
                ))
            except Exception as e:
                logger.warning("LLM 摘要失败，使用确定性分析: {}", e)
            emit("answer", "生成业务回答", answer_text)

            # 保存会话
            if self._memory:
                await self._memory.save(sid, question, answer_text, sql, rows)

            return AgentRunResult(
                sessionId=sid, answer=answer_text, sql=sql, data=rows,
                trace=trace, events=events, toolCalls=tool_calls,
                durationMs=int((time.time() - started) * 1000),
            )

        except Exception as e:
            detail = str(e).strip() or "未知错误"
            emit("error", "执行失败", detail)
            return AgentRunResult(
                sessionId=sid, answer=f"分析失败：{detail}", trace=trace,
                events=events, toolCalls=tool_calls,
                durationMs=int((time.time() - started) * 1000), error=detail,
            )

    async def _generate_sql(self, question: str, context: str, instructions: str, history: list) -> str:
        """LLM 生成 SQL：注入 wren 语义上下文 + 业务规则 + 历史。"""
        user_parts: list[str] = []
        if instructions:
            user_parts.extend(["Business rules:", instructions, ""])
        if context:
            user_parts.extend(["Semantic schema and similar queries for this question:", context, ""])
        if history:
            user_parts.append(self._format_history(history))
            user_parts.append("")
        user_parts.extend(["Question:", question])
        user_content = "\n".join(user_parts)

        messages = [
            {"role": "system", "content": SQL_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]
        resp = await self._llm.ainvoke(messages)
        return extract_sql(resp.content)

    async def _summarize(self, question: str, analysis, history: list) -> str:
        """LLM 防幻觉摘要。"""
        user_content = "\n\n".join([
            f"问题：{question}",
            f"数据：\n{json.dumps(analysis.table[:100], ensure_ascii=False, indent=2, default=str)}",
            f"初步观察：\n{chr(10).join(analysis.observations)}",
            "硬性要求：日期与数值必须逐字照抄上方数据，禁止改写、取整或推算；"
            "数据中不存在的字段如实说明“未包含”；历史对话仅供上下文参考，不得替代本次查询结果。",
        ])
        messages = [
            {"role": "system", "content": self._domain.system_prompt},
            *([{"role": "user", "content": self._format_history(history)}] if history else []),
            {"role": "user", "content": user_content},
        ]
        resp = await self._llm.ainvoke(messages)
        return resp.content

    def _format_history(self, history: list) -> str:
        lines = ["以下为本次会话的历史对话（仅供参考）："]
        for record in history:
            lines.append(f"用户：{record.get('question', '')}")
            lines.append(f"助手：{record.get('answer', '')}")
        return "\n".join(lines)

    async def _load_history(self, session_id: str, current_question: str) -> list:
        if not self._memory or not hasattr(self._memory, "get_history"):
            return []
        history = await self._memory.get_history(session_id)
        return [r for r in history if r.get("question") != current_question][-_HISTORY_INJECTION_TURNS:]

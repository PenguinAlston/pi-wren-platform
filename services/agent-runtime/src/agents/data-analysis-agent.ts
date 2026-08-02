import type { AgentEvent, AgentRunResult, AgentToolCall, ChatMessage } from '@pi-wren/shared-types';
import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import { randomUUID } from 'node:crypto';
import { createEvent } from '../events';
import type { ConversationRecord, MemoryStore } from '../memory';
import { AgentPlanner } from '../planner';
import { analyzeQueryResult } from '../tools/result-analysis-tool';
import type { AgentToolContext, ToolRegistry } from '../tools/registry';
import {
  buildRepairQuestion,
  missingRequestedFields,
  type RequestedField,
} from '../context/result-completeness';
import type { AgentDomainConfig } from './domain';

export interface DataAnalysisAgentDeps {
  /** 领域配置：id/标签/系统提示词 */
  domain: AgentDomainConfig;
  context: ContextEngine;
  sql: SqlExecutor;
  tools: ToolRegistry;
  model?: ModelProvider;
  memory?: MemoryStore;
}

export interface AnswerOptions {
  /** 已有会话 ID：续聊时传入，历史记录将注入摘要上下文。 */
  sessionId?: string;
  /** 事件回调：每个执行事件产出时调用（用于 SSE 流式输出）。 */
  onEvent?: (event: AgentEvent) => void;
}

/** 注入摘要上下文的最近对话轮数。 */
const HISTORY_INJECTION_TURNS = 3;

/** 把会话记录折叠为对话轮（user/assistant），供 SQL 生成指代消解。 */
function toTurns(records: ConversationRecord[]): { role: 'user' | 'assistant'; content: string }[] {
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const record of records) {
    turns.push({ role: 'user', content: record.question });
    turns.push({ role: 'assistant', content: record.answer });
  }
  return turns;
}

/** 结果完整性自检发现缺字段时的最大重查次数。 */
const MAX_REPAIR_ATTEMPTS = 1;

/**
 * 通用数据分析 Agent：问题 → 语义层生成 SQL → 查询 → 完整性自检(缺字段自动重查) → 分析 → (可选)LLM 摘要。
 * 与行业无关：领域差异全部由 domain 配置与注入的语义层/工具决定。
 */
export class DataAnalysisAgent {
  private readonly planner = new AgentPlanner();

  constructor(private readonly deps: DataAnalysisAgentDeps) {}

  get domain(): AgentDomainConfig {
    return this.deps.domain;
  }

  async answer(question: string, options: AnswerOptions = {}): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const sessionId = options.sessionId ?? randomUUID();
    const events: AgentEvent[] = [];
    const trace: string[] = [];
    const toolCalls: AgentToolCall[] = [];
    // 多轮上下文：先加载最近几轮（同时用于 SQL 生成指代消解与摘要注入）
    const history = await this.loadHistory(sessionId, question);
    const context: AgentToolContext = { question, history: toTurns(history) };

    const emit = (type: Parameters<typeof createEvent>[0], label: string, detail?: string) => {
      const event = createEvent(type, label, detail);
      events.push(event);
      trace.push(label);
      options.onEvent?.(event);
      return event;
    };

    try {
      emit('plan', '理解业务问题', question);

      let plan = this.planner.createPlan(question);
      emit(
        'observation',
        '生成执行计划',
        plan.map((s) => `${s.action}: ${s.description}`).join(' → '),
      );

      // 一次"生成 SQL → 执行"往返（重查时复用）
      const runQuery = async (targetQuestion: string, callLabel: string) => {
        const sqlStart = Date.now();
        const sqlResult = (await this.deps.tools.execute(
          'wren_generate_sql',
          targetQuestion,
          context,
        )) as { sql: string };
        const { sql } = sqlResult;
        toolCalls.push({
          name: 'wren_generate_sql',
          input: targetQuestion,
          output: sql,
          durationMs: Date.now() - sqlStart,
          ok: true,
        });
        emit('tool_call', callLabel, sql);

        const queryStart = Date.now();
        const result = (await this.deps.tools.execute('database_query', sql, context)) as {
          rows: Record<string, unknown>[];
          count: number | null;
        };
        toolCalls.push({
          name: 'database_query',
          input: sql,
          output: { rows: result.rows.length, count: result.count },
          durationMs: Date.now() - queryStart,
          ok: true,
        });
        emit('tool_result', `查询执行完成，返回 ${result.rows.length} 行`);
        return { sql, result };
      };

      let { sql, result } = await runQuery(question, '通过语义层生成 SQL');

      // 结果完整性自检：用户明确要求的字段（如保单号、被保人姓名）未返回 → 修订计划并自动重查
      let missing: RequestedField[] = missingRequestedFields(question, result.rows);
      for (let attempt = 0; missing.length > 0 && attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
        const labels = missing.map((m) => m.label).join('、');
        emit(
          'observation',
          '检查结果完整性',
          `查询结果缺少用户要求的字段：${labels}，重新生成 SQL`,
        );
        plan = [
          ...plan,
          {
            id: `revise_${attempt + 1}`,
            action: 'revise_sql',
            description: `补齐字段（${labels}）后重新生成并执行 SQL`,
          },
        ];
        emit(
          'observation',
          '修订执行计划',
          plan.map((s) => `${s.action}: ${s.description}`).join(' → '),
        );
        const repaired = await runQuery(
          buildRepairQuestion(question, missing),
          '修订后重新生成 SQL',
        );
        sql = repaired.sql;
        result = repaired.result;
        missing = missingRequestedFields(question, result.rows);
      }

      const analysis = analyzeQueryResult(result.rows, question);
      if (missing.length > 0) {
        const labels = missing.map((m) => m.label).join('、');
        const note = `本次查询结果仍缺少用户要求的字段：${labels}（数据库中该字段存在，但当前 SQL 未取到）。`;
        analysis.observations.push(note);
        analysis.summary = `${analysis.summary} ${note}`;
      }
      toolCalls.push({
        name: 'result_analysis',
        input: { rows: result.rows.length },
        output: analysis.summary,
        durationMs: 0,
        ok: true,
      });
      emit('observation', '分析查询结果', analysis.summary);

      let answer = analysis.summary;
      if (this.deps.model) {
        const summaryStart = Date.now();
        try {
          const summary = await this.summarize(question, analysis, history);
          answer = summary.content;
          toolCalls.push({
            name: 'llm_summarize',
            input: { question, historyTurns: history.length },
            output: { chars: summary.content.length },
            durationMs: Date.now() - summaryStart,
            ok: true,
          });
        } catch {
          // Keep the deterministic summary if the LLM is unavailable.
        }
      }
      emit('answer', '生成业务回答', answer);

      await this.saveMemory(sessionId, question, answer, sql, result.rows);

      return {
        sessionId,
        answer,
        sql,
        data: result.rows,
        trace,
        events,
        toolCalls,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? error.message : String(error);
      const message = detail.trim() ? detail : '未知错误';
      emit('error', '执行失败', message);
      return {
        sessionId,
        answer: `分析失败：${message}`,
        trace,
        events,
        toolCalls,
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }
  }

  /** 读取会话历史（仅当存储支持 getHistory 时），取最近 N 轮。 */
  private async loadHistory(
    sessionId: string,
    currentQuestion: string,
  ): Promise<ConversationRecord[]> {
    if (!this.deps.memory?.getHistory) {
      return [];
    }
    const history = await this.deps.memory.getHistory(sessionId);
    // 排除与当前问题相同的记录（防重复注入），仅保留最近几轮
    return history.filter((r) => r.question !== currentQuestion).slice(-HISTORY_INJECTION_TURNS);
  }

  private async summarize(
    question: string,
    analysis: { summary: string; observations: string[]; table: Record<string, unknown>[] },
    history: ConversationRecord[] = [],
  ): Promise<ChatMessage> {
    if (!this.deps.model) {
      throw new Error('No model provider configured');
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: this.deps.domain.systemPrompt },
      {
        role: 'user',
        content: [
          ...(history.length > 0 ? this.formatHistory(history) : []),
          `问题：${question}`,
          `数据：\n${JSON.stringify(analysis.table, null, 2)}`,
          `初步观察：\n${analysis.observations.join('\n')}`,
          '硬性要求：日期与数值必须逐字照抄上方数据，禁止改写、取整或推算；数据中不存在的字段如实说明"未包含"；若查询结果缺少用户明确要求的字段，应说明"本次查询未取到该字段"而不是断言数据库不存在该数据；历史对话仅供上下文参考，不得替代本次查询结果。',
        ].join('\n\n'),
      },
    ];
    return this.deps.model.chat(messages, {
      temperature: 0.2,
      maxTokens: 600,
      signal: AbortSignal.timeout(45_000),
    });
  }

  private formatHistory(history: ConversationRecord[]): string[] {
    const lines: string[] = ['以下为本次会话的历史对话（仅供参考）：'];
    for (const record of history) {
      lines.push(`用户：${record.question}`);
      lines.push(`助手：${record.answer}`);
    }
    return lines;
  }

  private async saveMemory(
    sessionId: string,
    question: string,
    answer: string,
    sql: string,
    data: unknown[],
  ): Promise<void> {
    if (!this.deps.memory) {
      return;
    }
    await this.deps.memory.save({
      sessionId,
      question,
      answer,
      sql,
      data,
      createdAt: new Date().toISOString(),
    });
  }
}

import type { AgentEvent, AgentRunResult, AgentToolCall, ChatMessage } from '@pi-wren/shared-types';
import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import { randomUUID } from 'node:crypto';
import { createEvent } from '../events';
import type { MemoryStore } from '../memory';
import { AgentPlanner } from '../planner';
import { analyzeQueryResult } from '../tools/result-analysis-tool';
import type { AgentToolContext, ToolRegistry } from '../tools/registry';
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

/**
 * 通用数据分析 Agent：问题 → 语义层生成 SQL → 查询 → 分析 → (可选)LLM 摘要。
 * 与行业无关：领域差异全部由 domain 配置与注入的语义层/工具决定。
 */
export class DataAnalysisAgent {
  private readonly planner = new AgentPlanner();

  constructor(private readonly deps: DataAnalysisAgentDeps) {}

  get domain(): AgentDomainConfig {
    return this.deps.domain;
  }

  async answer(question: string): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const sessionId = randomUUID();
    const events: AgentEvent[] = [];
    const trace: string[] = [];
    const toolCalls: AgentToolCall[] = [];
    const context: AgentToolContext = { question };

    const emit = (type: Parameters<typeof createEvent>[0], label: string, detail?: string) => {
      const event = createEvent(type, label, detail);
      events.push(event);
      trace.push(label);
      return event;
    };

    try {
      emit('plan', '理解业务问题', question);

      const plan = this.planner.createPlan(question);
      emit('observation', '生成执行计划', plan.map((s) => `${s.action}: ${s.description}`).join(' → '));

      const sqlStart = Date.now();
      const sqlResult = (await this.deps.tools.execute(
        'wren_generate_sql',
        question,
        context,
      )) as { sql: string };
      const { sql } = sqlResult;
      toolCalls.push({
        name: 'wren_generate_sql',
        input: question,
        output: sql,
        durationMs: Date.now() - sqlStart,
        ok: true,
      });
      emit('tool_call', '通过语义层生成 SQL', sql);

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

      const analysis = analyzeQueryResult(result.rows, question);
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
          const summary = await this.summarize(question, analysis);
          answer = summary.content;
          toolCalls.push({
            name: 'llm_summarize',
            input: { question },
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

  private async summarize(
    question: string,
    analysis: { summary: string; observations: string[]; table: Record<string, unknown>[] },
  ): Promise<ChatMessage> {
    if (!this.deps.model) {
      throw new Error('No model provider configured');
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: this.deps.domain.systemPrompt },
      {
        role: 'user',
        content: [
          `问题：${question}`,
          `数据：\n${JSON.stringify(analysis.table, null, 2)}`,
          `初步观察：\n${analysis.observations.join('\n')}`,
        ].join('\n\n'),
      },
    ];
    return this.deps.model.chat(messages, { temperature: 0.2, maxTokens: 600 });
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

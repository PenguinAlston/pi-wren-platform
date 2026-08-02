import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@pi-wren/shared-types';
import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import { DataAnalysisAgent } from './data-analysis-agent';
import { financeDomain, insuranceDomain } from './domain';
import { createDataAnalysisTools } from '../tools';
import { InMemoryMemoryStore } from '../memory';

const fakeContext: ContextEngine = {
  generateSQL: async (q) => `SELECT * FROM finance_fact WHERE question = '${q}';`,
  searchKnowledge: async () => ['demo knowledge'],
  getMetric: async (name) => ({ name, definition: 'demo' }),
  listMetrics: async () => [],
};

const fakeSql: SqlExecutor = {
  query: async () => ({
    rows: [
      { quarter: 'Q1', profit: 400000 },
      { quarter: 'Q2', profit: 250000 },
    ],
    count: 2,
  }),
};

function makeAgent(
  domain = financeDomain,
  model?: ModelProvider,
  memory = new InMemoryMemoryStore(),
) {
  const sql = fakeSql;
  const tools = createDataAnalysisTools(fakeContext, sql);
  return {
    agent: new DataAnalysisAgent({ domain, context: fakeContext, sql, tools, model, memory }),
    memory,
  };
}

describe('DataAnalysisAgent', () => {
  it('runs the full pipeline without a model and returns a deterministic summary', async () => {
    const { agent } = makeAgent();
    const result = await agent.answer('为什么利润下降？');

    expect(result.answer).toContain('Q2');
    expect(result.sql).toContain('finance_fact');
    expect(result.data).toHaveLength(2);
    expect(result.error).toBeUndefined();
    expect(result.trace).toContain('通过语义层生成 SQL');
    expect(result.events.some((e) => e.type === 'plan')).toBe(true);
    expect(result.events.some((e) => e.type === 'answer')).toBe(true);
    expect(result.toolCalls.map((t) => t.name)).toEqual([
      'wren_generate_sql',
      'database_query',
      'result_analysis',
    ]);
  });

  it('uses the LLM summary when a model is configured', async () => {
    const model: ModelProvider = {
      name: 'mock',
      chat: async (messages: ChatMessage[]) => {
        expect(messages.at(0)?.role).toBe('system');
        expect(messages.at(0)?.content).toContain('财务分析师');
        expect(messages.at(0)?.content).toContain('禁止编造');
        // 摘要提示词包含防幻觉硬性要求
        expect(messages.at(-1)?.content).toContain('逐字照抄');
        return { role: 'assistant', content: 'LLM 摘要：利润下滑 37.5%。' };
      },
    };
    const { agent } = makeAgent(financeDomain, model);
    const result = await agent.answer('为什么利润下降？');

    expect(result.answer).toBe('LLM 摘要：利润下滑 37.5%。');
    expect(result.toolCalls.some((t) => t.name === 'llm_summarize')).toBe(true);
  });

  it('uses the insurance domain system prompt for insurance agents', async () => {
    const model: ModelProvider = {
      name: 'mock',
      chat: async (messages: ChatMessage[]) => ({
        role: 'assistant',
        content: messages.at(0)?.content?.includes('保险行业') ? '保险摘要' : '错误提示词',
      }),
    };
    const { agent } = makeAgent(insuranceDomain, model);
    const result = await agent.answer('赔付率如何？');

    expect(result.answer).toBe('保险摘要');
  });

  it('returns a structured error when SQL generation fails', async () => {
    const brokenContext: ContextEngine = {
      ...fakeContext,
      generateSQL: async () => {
        throw new Error('Wren service unavailable');
      },
    };
    const sql = fakeSql;
    const tools = createDataAnalysisTools(brokenContext, sql);
    const agent = new DataAnalysisAgent({
      domain: financeDomain,
      context: brokenContext,
      sql,
      tools,
    });

    const result = await agent.answer('为什么利润下降？');

    expect(result.error).toContain('Wren service unavailable');
    expect(result.events.some((e) => e.type === 'error')).toBe(true);
  });

  it('persists the conversation to memory when a store is provided', async () => {
    const memory = new InMemoryMemoryStore();
    const { agent } = makeAgent(financeDomain, undefined, memory);

    await agent.answer('为什么利润下降？');

    const records = await memory.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.question).toBe('为什么利润下降？');
  });
});

describe('DataAnalysisAgent session & streaming', () => {
  it('emits events via onEvent callback in order', async () => {
    const { agent } = makeAgent();
    const emitted: string[] = [];
    await agent.answer('为什么利润下降？', {
      onEvent: (event) => emitted.push(event.type),
    });
    expect(emitted).toEqual([
      'plan',
      'observation',
      'tool_call',
      'tool_result',
      'observation',
      'answer',
    ]);
  });

  it('continues an existing session and injects history into the summary prompt', async () => {
    const memory = new InMemoryMemoryStore();
    const { agent } = makeAgent(financeDomain, undefined, memory);
    await agent.answer('为什么利润下降？', { sessionId: 'sess-1' });

    let historyInjected = false;
    const model: ModelProvider = {
      name: 'mock',
      chat: async (messages: ChatMessage[]) => {
        historyInjected = messages.some(
          (m) => m.content.includes('历史对话') && m.content.includes('为什么利润下降'),
        );
        return { role: 'assistant', content: '续聊摘要' };
      },
    };
    const { agent: agentWithModel } = makeAgent(financeDomain, model, memory);

    const result = await agentWithModel.answer('那成本呢？', { sessionId: 'sess-1' });
    expect(result.sessionId).toBe('sess-1');
    expect(historyInjected).toBe(true);
    expect(result.answer).toBe('续聊摘要');
  });
});

describe('DataAnalysisAgent result completeness repair (P1)', () => {
  it('re-queries when the result is missing requested detail fields', async () => {
    let sqlCalls = 0;
    const context: ContextEngine = {
      ...fakeContext,
      generateSQL: async () => {
        sqlCalls += 1;
        return sqlCalls === 1
          ? "SELECT d.dict_label AS policy_status, COUNT(*) AS policy_count FROM insurance_policy p LEFT JOIN sys_dict d ON d.dict_type = 'policy_status' AND d.dict_value = p.policy_status GROUP BY d.dict_label;"
          : "SELECT p.policy_no, c.customer_name AS insured_name, p.end_date FROM insurance_policy p LEFT JOIN ins_customer c ON c.customer_id = p.insured_id WHERE p.end_date BETWEEN '2025-01-01' AND '2025-12-31';";
      },
    };
    const sql: SqlExecutor = {
      query: async (query) =>
        query.includes('GROUP BY')
          ? { rows: [{ policy_status: '承保有效', policy_count: 7 }], count: 1 }
          : {
              rows: [{ policy_no: 'P20240002', insured_name: '刘美玲', end_date: '2025-03-31' }],
              count: 1,
            },
    };
    const tools = createDataAnalysisTools(context, sql);
    const agent = new DataAnalysisAgent({ domain: insuranceDomain, context, sql, tools });

    const result = await agent.answer('2025终止的保单有哪些？同时告诉我被保人的姓名和保单号码');

    // 自动重查后返回包含明细字段的结果
    expect(result.data).toEqual([
      { policy_no: 'P20240002', insured_name: '刘美玲', end_date: '2025-03-31' },
    ]);
    expect(result.toolCalls.filter((t) => t.name === 'wren_generate_sql')).toHaveLength(2);
    expect(result.toolCalls.filter((t) => t.name === 'database_query')).toHaveLength(2);
    expect(result.trace.some((t) => t.includes('检查结果完整性'))).toBe(true);
    expect(result.trace.some((t) => t.includes('修订执行计划'))).toBe(true);
    expect(result.answer).toContain('刘美玲');
    expect(result.error).toBeUndefined();
  });

  it('keeps a single round-trip when the result already has the requested fields', async () => {
    const context: ContextEngine = {
      ...fakeContext,
      generateSQL: async () =>
        'SELECT p.policy_no, c.customer_name AS insured_name, p.end_date FROM insurance_policy p LEFT JOIN ins_customer c ON c.customer_id = p.insured_id;',
    };
    const sql: SqlExecutor = {
      query: async () => ({
        rows: [{ policy_no: 'P20240002', insured_name: '刘美玲', end_date: '2025-03-31' }],
        count: 1,
      }),
    };
    const tools = createDataAnalysisTools(context, sql);
    const agent = new DataAnalysisAgent({ domain: insuranceDomain, context, sql, tools });

    const result = await agent.answer('2025终止的保单有哪些？同时告诉我被保人的姓名和保单号码');

    expect(result.toolCalls.filter((t) => t.name === 'wren_generate_sql')).toHaveLength(1);
    expect(result.trace.some((t) => t.includes('检查结果完整性'))).toBe(false);
    expect(result.answer).toContain('P20240002');
  });
});

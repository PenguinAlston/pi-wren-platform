import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@pi-wren/shared-types';
import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import { FinanceAgent } from './finance-agent';
import { createFinanceTools } from '../tools';
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

function makeAgent(model?: ModelProvider, memory = new InMemoryMemoryStore()) {
  const sql = fakeSql;
  const tools = createFinanceTools(fakeContext, sql);
  return { agent: new FinanceAgent({ context: fakeContext, sql, tools, model, memory }), memory };
}

describe('FinanceAgent', () => {
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
        return { role: 'assistant', content: 'LLM 摘要：利润下滑 37.5%。' };
      },
    };
    const { agent } = makeAgent(model);
    const result = await agent.answer('为什么利润下降？');

    expect(result.answer).toBe('LLM 摘要：利润下滑 37.5%。');
    expect(result.toolCalls.some((t) => t.name === 'llm_summarize')).toBe(true);
  });

  it('returns a structured error when SQL generation fails', async () => {
    const brokenContext: ContextEngine = {
      ...fakeContext,
      generateSQL: async () => {
        throw new Error('Wren service unavailable');
      },
    };
    const sql = fakeSql;
    const tools = createFinanceTools(brokenContext, sql);
    const agent = new FinanceAgent({ context: brokenContext, sql, tools });

    const result = await agent.answer('为什么利润下降？');

    expect(result.error).toContain('Wren service unavailable');
    expect(result.events.some((e) => e.type === 'error')).toBe(true);
  });

  it('persists the conversation to memory when a store is provided', async () => {
    const memory = new InMemoryMemoryStore();
    const { agent } = makeAgent(undefined, memory);

    await agent.answer('为什么利润下降？');

    const records = await memory.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.question).toBe('为什么利润下降？');
  });
});

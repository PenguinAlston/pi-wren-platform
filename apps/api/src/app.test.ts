import { describe, expect, it, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { pino } from 'pino';
import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import { DataAnalysisAgent, createFinanceTools, financeDomain, insuranceDomain } from '@pi-wren/agent-runtime';
import { createApp } from './app';
import { loadConfig } from './config';
import type { ApiConfig } from './config';
import type { AgentSpec, ApiDeps } from './deps';

const config: ApiConfig = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

function buildContext(prefix: string): ContextEngine {
  return {
    generateSQL: async () => `SELECT * FROM ${prefix};`,
    searchKnowledge: async () => [],
    getMetric: async (name) => ({ name, definition: 'demo' }),
    listMetrics: async () => [{ name: 'demo_metric', definition: 'demo' }],
  };
}

const sql: SqlExecutor = {
  query: async () => ({
    rows: [
      { quarter: 'Q1', profit: 400000 },
      { quarter: 'Q2', profit: 250000 },
    ],
    count: 2,
  }),
};

const insuranceSql: SqlExecutor = {
  query: async () => ({
    rows: [
      { product_name: '车险', claim_amount: 28000 },
      { product_name: '重疾险', claim_amount: 200000 },
    ],
    count: 2,
  }),
};

function buildAgent(
  domain: typeof financeDomain,
  context: ContextEngine,
  executor: SqlExecutor,
): AgentSpec {
  const tools = createFinanceTools(context, executor);
  const agent = new DataAnalysisAgent({ domain, context, sql: executor, tools });
  return {
    id: domain.id,
    label: domain.label,
    description: domain.description,
    agent,
    metrics: [],
  };
}

const logger = pino({ level: 'silent' });
const deps: ApiDeps = {
  config,
  logger,
  agents: [
    buildAgent(financeDomain, buildContext('finance_fact'), sql),
    buildAgent(insuranceDomain, buildContext('insurance_policy'), insuranceSql),
  ],
};

const app = createApp(deps);
const server: Server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('api', () => {
  it('returns health status', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('lists registered agents', async () => {
    const response = await fetch(`${baseUrl}/api/agents`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agents: { id: string }[] };
    expect(body.agents.map((a) => a.id)).toEqual(['finance', 'insurance']);
  });

  it('answers a finance question through the default chat route', async () => {
    const response = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '为什么利润下降？' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { answer: string; sql: string };
    expect(body.answer).toContain('Q2');
    expect(body.sql).toContain('finance_fact');
  });

  it('answers an insurance question through the domain route', async () => {
    const response = await fetch(`${baseUrl}/api/agent/insurance/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '各险种赔付率如何？' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { answer: string; sql: string };
    expect(body.sql).toContain('insurance_policy');
    expect(body.answer).toContain('车险');
  });

  it('rejects unknown domains', async () => {
    const response = await fetch(`${baseUrl}/api/agent/nope/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(response.status).toBe(404);
  });

  it('rejects requests without a message', async () => {
    const response = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

describe('api sse stream', () => {
  it('streams agent events and a final done frame', async () => {
    const response = await fetch(`${baseUrl}/api/agent/finance/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '为什么利润下降？', sessionId: 'sse-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const text = await response.text();
    expect(text).toContain('event: plan');
    expect(text).toContain('event: tool_call');
    expect(text).toContain('event: answer');
    expect(text).toContain('event: done');
    expect(text).toContain('"sessionId":"sse-1"');
    expect(text).toContain('"label":"生成业务回答"');
  });

  it('rejects invalid stream requests', async () => {
    const response = await fetch(`${baseUrl}/api/agent/finance/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

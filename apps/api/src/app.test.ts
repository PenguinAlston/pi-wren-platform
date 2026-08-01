import { describe, expect, it, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { pino } from 'pino';
import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import { FinanceAgent, createFinanceTools } from '@pi-wren/agent-runtime';
import { createApp } from './app';
import { loadConfig } from './config';
import type { ApiConfig } from './config';

const config: ApiConfig = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

const context: ContextEngine = {
  generateSQL: async () => 'SELECT quarter, profit FROM finance_fact ORDER BY quarter;',
  searchKnowledge: async () => [],
  getMetric: async (name) => ({ name, definition: 'demo' }),
  listMetrics: async () => [],
};

const sql: SqlExecutor = {
  query: async () => ({
    rows: [
      { quarter: 'Q1', profit: 400000 },
      { quarter: 'Q2', profit: 250000 },
    ],
    count: 2,
  }),
};

const logger = pino({ level: 'silent' });
const tools = createFinanceTools(context, sql);
const agent = new FinanceAgent({ context, sql, tools });
const app = createApp({ config, logger, agent, metrics: [] });

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

  it('answers a chat message with the full agent result', async () => {
    const response = await fetch(`${baseUrl}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '为什么利润下降？' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { answer: string; sql: string; data: unknown[] };
    expect(body.answer).toContain('Q2');
    expect(body.sql).toContain('finance_fact');
    expect(body.data).toHaveLength(2);
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

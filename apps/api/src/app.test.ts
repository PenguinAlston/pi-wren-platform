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
    source: 'builtin',
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

// ---------- 自定义 Agent 管理 API ----------
import {
  AgentRegistry,
  InMemoryAgentConfigStore,
  type CustomAgentConfig,
  type CustomAgentFactory,
} from '@pi-wren/agent-registry';

const ADMIN_TOKEN = 'test-admin-token';
const SECRET_KEY = 'test-secret-0123456789abcdef';

function buildAdminDeps(base: ApiDeps): { deps: ApiDeps; server: Server; baseUrl: string } {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ADMIN_TOKEN,
    AGENT_SECRET_KEY: SECRET_KEY,
  });
  const factory: CustomAgentFactory<AgentSpec> = {
    async build(agentConfig: CustomAgentConfig) {
      const template = base.agents[0]!;
      return {
        id: agentConfig.agentId,
        label: agentConfig.label,
        description: agentConfig.description ?? '',
        agent: template.agent,
        metrics: [],
        source: 'custom',
      };
    },
  };
  const registry = new AgentRegistry<AgentSpec>({
    store: new InMemoryAgentConfigStore(),
    factory,
    secretKey: SECRET_KEY,
  });
  const deps: ApiDeps = { ...base, config, customAgents: registry };
  const server: Server = createApp(deps).listen(0);
  return { deps, server, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

const VALID_MDL = `name: demo
models:
  - name: product
    table: demo_product
    columns:
      - name: id
        type: integer
intents:
  - name: count_all
    keywords: [有多少, 数量]
    sql: SELECT COUNT(*) FROM demo_product
`;

describe('admin agents api', () => {
  const admin = buildAdminDeps(deps);
  const base = admin.baseUrl;

  afterAll(async () => {
    await new Promise<void>((resolve) => admin.server.close(() => resolve()));
  });

  it('returns 503 when ADMIN_TOKEN is not configured', async () => {
    const response = await fetch(`${baseUrl}/api/admin/agents`);
    expect(response.status).toBe(503);
  });

  it('rejects requests without a valid admin token', async () => {
    const noToken = await fetch(`${base}/api/admin/agents`, { headers: {} });
    expect(noToken.status).toBe(401);

    const badToken = await fetch(`${base}/api/admin/agents`, {
      headers: { 'x-admin-token': 'wrong' },
    });
    expect(badToken.status).toBe(401);
  });

  it('validates MDL without persisting', async () => {
    const ok = await fetch(`${base}/api/admin/agents/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ mdl: VALID_MDL }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { models: string[] };
    expect(body.models).toContain('demo_product');

    const bad = await fetch(`${base}/api/admin/agents/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ mdl: 'name: x' }),
    });
    expect(bad.status).toBe(400);
  });

  it('registers a custom agent and exposes it in the public list', async () => {
    const response = await fetch(`${base}/api/admin/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({
        agentId: 'my-erp',
        name: 'ERP 查询',
        label: 'ERP 系统查询',
        mdl: VALID_MDL,
        db: { host: 'localhost', port: 5432, database: 'erp', user: 'demo', password: 'p@ss' },
      }),
    });
    expect(response.status).toBe(201);

    const list = (await fetch(`${base}/api/admin/agents`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    }).then((r) => r.json())) as { agents: { agentId: string; connection: string; mdl?: string }[] };
    const created = list.agents.find((a) => a.agentId === 'my-erp');
    expect(created?.connection).toContain('***@');
    expect(created?.connection).not.toContain('p@ss');
    expect(created?.mdl).toBeUndefined(); // 列表不返回 mdl

    const publicList = (await fetch(`${base}/api/agents`).then((r) => r.json())) as {
      agents: { id: string; source: string }[];
    };
    expect(publicList.agents.some((a) => a.id === 'my-erp' && a.source === 'custom')).toBe(true);
  });

  it('rejects duplicate agent ids', async () => {
    const response = await fetch(`${base}/api/admin/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({
        agentId: 'my-erp',
        name: 'Again',
        label: 'Again',
        mdl: VALID_MDL,
        db: { database: 'erp', user: 'u', password: 'p' },
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({});
  });

  it('updates and deletes a custom agent', async () => {
    const update = await fetch(`${base}/api/admin/agents/my-erp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ label: 'ERP 新名称' }),
    });
    expect(update.status).toBe(200);

    const detail = (await fetch(`${base}/api/admin/agents/my-erp`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    }).then((r) => r.json())) as { agent: { label: string; mdl: string } };
    expect(detail.agent.label).toBe('ERP 新名称');
    expect(detail.agent.mdl).toContain('demo_product');

    const del = await fetch(`${base}/api/admin/agents/my-erp`, {
      method: 'DELETE',
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    expect(del.status).toBe(204);

    const missing = await fetch(`${base}/api/admin/agents/my-erp`, {
      headers: { 'x-admin-token': ADMIN_TOKEN },
    });
    expect(missing.status).toBe(404);
  });
});

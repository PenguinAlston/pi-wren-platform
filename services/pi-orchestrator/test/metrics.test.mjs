import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgentService } from '../src/agent-service.mjs';
import { createMetrics } from '../src/metrics.mjs';
import { createSessionStore } from '../src/sessions.mjs';
import { createHandler, startServer } from '../src/server.mjs';

describe('metrics 模块', () => {
  it('计数器：无标签/带标签/累加，暴露为 _total', () => {
    const m = createMetrics();
    m.incCounter('answers', { status: 'ok' });
    m.incCounter('answers', { status: 'ok' });
    m.incCounter('answers', { status: 'error' });
    m.incCounter('uptime_like');
    const text = m.render();
    expect(text).toContain('piwrenpi_answers_total{status="ok"} 2');
    expect(text).toContain('piwrenpi_answers_total{status="error"} 1');
    expect(text).toContain('piwrenpi_uptime_like_total 1');
  });

  it('直方图：分桶累积 + sum/count，支持标签与引号转义', () => {
    const m = createMetrics({ bucketsMs: [100, 200] });
    m.observe('tool_duration', 50, { tool: 'ask"da' });
    m.observe('tool_duration', 150, { tool: 'ask"da' });
    m.observe('tool_duration', 999, { tool: 'ask"da' });
    const text = m.render();
    expect(text).toContain('# TYPE piwrenpi_tool_duration_milliseconds histogram');
    expect(text).toContain('piwrenpi_tool_duration_milliseconds_bucket{tool="ask\\"da",le="100"} 1');
    expect(text).toContain('piwrenpi_tool_duration_milliseconds_bucket{tool="ask\\"da",le="200"} 2');
    expect(text).toContain('piwrenpi_tool_duration_milliseconds_bucket{tool="ask\\"da",le="+Inf"} 3');
    expect(text).toContain('piwrenpi_tool_duration_milliseconds_sum{tool="ask\\"da"} 1199.0');
    expect(text).toContain('piwrenpi_tool_duration_milliseconds_count{tool="ask\\"da"} 3');
  });

  it('uptime gauge 存在', () => {
    const text = createMetrics().render();
    expect(text).toMatch(/piwrenpi_process_uptime_seconds \d+\.\d/);
  });
});

describe('agent-service 指标埋点', () => {
  const CONFIG = { maxToolCalls: 8, maxDurationMs: 175_000, historyTurns: 3, toolTimeoutMs: 120_000 };

  const okTool = {
    name: 'ask_data',
    execute: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, sql: 'SELECT 1' }) }] }),
  };
  const failTool = {
    name: 'graph_query',
    execute: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'boom' }) }] }),
  };
  /** stub agent：prompt 时把每个工具执行一次（驱动 guardToolCall 埋点）。 */
  const stubCreateAgent = ({ tools }) => ({
    prompt: async () => {
      for (const tool of tools) await tool.execute('1', {});
    },
    subscribe: () => {},
  });

  it('工具成功/失败分别计数并记录时长，回答计数 ok', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-metrics-'));
    const metrics = createMetrics();
    const service = createAgentService({
      config: CONFIG,
      model: 'stub',
      tools: [okTool, failTool],
      store: createSessionStore(dir),
      createAgent: stubCreateAgent,
      metrics,
    });
    await service.run({ userKey: 'u1', sessionId: 's1', question: '各险种赔付率？' });
    const text = metrics.render();
    expect(text).toContain('piwrenpi_tool_calls_total{status="ok",tool="ask_data"} 1');
    expect(text).toContain('piwrenpi_tool_calls_total{status="error",tool="graph_query"} 1');
    expect(text).toContain('piwrenpi_tool_duration_milliseconds_count{tool="ask_data"} 1');
    expect(text).toContain('piwrenpi_answers_total{status="ok"} 1');
    expect(text).not.toContain('piwrenpi_guardrail_rejects_total');
  });

  it('护栏拒绝计数', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-metrics-'));
    const metrics = createMetrics();
    // stub agent 连续调用同一工具两次（上限 1 → 第二次被拒）
    const service = createAgentService({
      config: { ...CONFIG, maxToolCalls: 1 },
      model: 'stub',
      tools: [okTool],
      store: createSessionStore(dir),
      createAgent: ({ tools }) => ({
        prompt: async () => {
          await tools[0].execute('1', {});
          await tools[0].execute('2', {});
        },
        subscribe: () => {},
      }),
      metrics,
    });
    await service.run({ userKey: 'u1', sessionId: 's1', question: '问' });
    const text = metrics.render();
    expect(text).toContain('piwrenpi_guardrail_rejects_total{tool="ask_data"} 1');
  });
});

describe('server /metrics 端点', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-metrics-http-'));
    const config = { internalToken: 'secret-token', maxToolCalls: 8, maxDurationMs: 175_000, historyTurns: 3, toolTimeoutMs: 120_000 };
    const metrics = createMetrics();
    server = await startServer({
      config,
      store: createSessionStore(dir),
      service: { async run() { return { answer: 'ok', events: [], durationMs: 1, toolCalls: 0 }; } },
      metrics,
      listen: true,
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const headers = () => ({ 'x-internal-token': 'secret-token' });

  it('健康检查后 /metrics 输出 Prometheus 文本并统计请求', async () => {
    await fetch(`${baseUrl}/health`, { headers: headers() });
    await fetch(`${baseUrl}/not-exist`, { headers: headers() });
    const res = await fetch(`${baseUrl}/metrics`, { headers: headers() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('piwrenpi_http_requests_total{route="health",status="200"} 1');
    expect(text).toContain('piwrenpi_http_requests_total{route="other",status="404"} 1');
    expect(text).toMatch(/piwrenpi_http_requests_total\{route="metrics",status="200"\} \d+/);
  });

  it('无 token 401（同样计入指标）', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(401);
  });

  it('createHandler 默认无 metrics 时不报错', async () => {
    const handler = createHandler({ config: { internalToken: 't' }, store: {}, service: {} });
    expect(typeof handler).toBe('function');
  });
});

import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Agent } from '@earendil-works/pi-agent-core';
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { loadConfig } from './config.mjs';
import { sseFrame, uiEvent } from './events.mjs';
import { createMetrics } from './metrics.mjs';
import { createSessionStore } from './sessions.mjs';
import { createPgSessionStore } from './sessions_pg.mjs';
import { createAskDataTool } from './tools/ask_data.mjs';
import { createTraditionalQueryTool } from './tools/traditional_query.mjs';
import { createGraphQueryTool } from './tools/graph_query.mjs';
import { createAgentService } from './agent-service.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(value, fallback) {
  return typeof value === 'string' && ID_RE.test(value) ? value : fallback;
}

/** DashScope 兼容 provider + 模型（与 docs/spikes/pi-agent 一致）。 */
function buildModel(config) {
  const credentials = new InMemoryCredentialStore();
  const provider = createProvider({
    id: 'pi-llm',
    name: 'PI LLM',
    baseUrl: config.openaiBaseUrl,
    auth: { apiKey: envApiKeyAuth('PI LLM API key', ['OPENAI_API_KEY']) },
    models: [{
      id: config.openaiModel, name: config.openaiModel, api: 'openai-completions',
      provider: 'pi-llm', baseUrl: config.openaiBaseUrl, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768, maxTokens: 4096,
    }],
    api: { 'openai-completions': openAICompletionsApi() },
  });
  const models = createModels({ credentials });
  models.setProvider(provider);
  return { model: models.getModel('pi-llm', config.openaiModel), streamFn: models.streamSimple.bind(models) };
}

/** 生产 createAgent：真 pi Agent（0.83 API，见 docs/spikes/pi-agent）。 */
export function createPiAgent({ systemPrompt, model, tools, sessionId, onPiEvent, streamFn }) {
  const agent = new Agent({
    initialState: { systemPrompt, model, tools },
    streamFn,
    sessionId,
  });
  agent.subscribe(onPiEvent);
  return {
    prompt: (question) => agent.prompt(question),
    abort: typeof agent.abort === 'function' ? () => agent.abort() : null,
  };
}

export function createAppService({ config, store, createAgent = null, metrics = createMetrics() }) {
  if (createAgent) {
    return {
      metrics,
      service: createAgentService({ config, model: 'stub', tools: [createAskDataTool(config)], store, createAgent, metrics }),
    };
  }
  const { model, streamFn } = buildModel(config);
  const service = createAgentService({
    config,
    model,
    // 每次请求注入当前用户身份（internal 路由按此反查权限）
    toolsFactory: ({ userKey }) => {
      const identity = { 'x-user-id': userKey };
      const common = { ...config, identityHeaders: identity };
      return [
        createAskDataTool(common),
        createTraditionalQueryTool(common),
        createGraphQueryTool(common),
      ];
    },
    store,
    createAgent: (args) => createPiAgent({ ...args, streamFn }),
    metrics,
  });
  return { service, metrics };
}

/** 请求路由粗分类（避免原始路径里的 sessionId 造成标签爆炸）。 */
function routeKind(method, pathname) {
  if (pathname === '/health') return 'health';
  if (pathname === '/metrics') return 'metrics';
  if (pathname === '/sessions') return 'sessions_list';
  if (pathname.startsWith('/sessions/')) {
    if (pathname.endsWith('/messages')) return 'sse_run';
    return method === 'DELETE' ? 'sessions_delete' : 'sessions_get';
  }
  return 'other';
}

export function createHandler({ config, store, service, metrics = null }) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const startedAt = Date.now();
    const send = (status, body) => {
      metrics?.incCounter('http_requests', { route: routeKind(req.method ?? '', url.pathname), status: String(status) });
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    const sendSse = () => {
      metrics?.incCounter('http_requests', { route: 'sse_run', status: '200' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
    };

    // internal token 全端点强制（常量时间比较）；支持 x-internal-token 或 Authorization: Bearer（Prometheus 抓取）
    const token = String(req.headers['x-internal-token'] ?? '');
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers['authorization'] ?? ''))?.[1] ?? '';
    const provided = token || bearer;
    const expected = config.internalToken;
    const okToken =
      expected.length > 0 &&
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!okToken) {
      send(401, { error: 'invalid internal token' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      send(200, { status: 'ok' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      metrics?.incCounter('http_requests', { route: 'metrics', status: '200' });
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(metrics ? metrics.render() : '');
      return;
    }

    const userKey = safeId(req.headers['x-user-id'] ?? '', 'anonymous');
    const pathSessionId = url.pathname.split('/')[2] ?? '';

    if (req.method === 'GET' && url.pathname === '/sessions') {
      const search = url.searchParams.get('search') ?? '';
      send(200, { sessions: await store.list(userKey, search) });
      return;
    }
    if (pathSessionId && req.method === 'GET' && url.pathname.startsWith('/sessions/')) {
      const session = await store.get(userKey, pathSessionId);
      if (!session) {
        send(404, { error: 'session not found' });
        return;
      }
      send(200, session);
      return;
    }
    if (pathSessionId && req.method === 'DELETE' && url.pathname.startsWith('/sessions/')) {
      await store.remove(userKey, pathSessionId);
      send(200, { ok: true });
      return;
    }

    if (
      pathSessionId &&
      req.method === 'POST' &&
      url.pathname.startsWith('/sessions/') &&
      url.pathname.endsWith('/messages')
    ) {
      let body = '';
      for await (const chunk of req) body += chunk;
      let message = '';
      try {
        message = String(JSON.parse(body).message ?? '').trim();
      } catch {
        send(400, { error: 'invalid JSON body' });
        return;
      }
      if (!message || message.length > 4000) {
        send(400, { error: 'message is required (1-4000 chars)' });
        return;
      }

      sendSse();
      let closed = false;
      req.on('close', () => {
        closed = true;
      });

      try {
        const result = await service.run({
          userKey,
          sessionId: pathSessionId,
          question: message,
          onUiEvent: (event) => {
            if (!closed) res.write(sseFrame(event.type, event));
          },
          // token 级流式：LLM 文本增量实时下发（answer_delta 帧契约见 protocol/events.schema.json）
          onDelta: (delta) => {
            if (!closed && delta) res.write(sseFrame('answer_delta', { delta }));
          },
        });
        metrics?.observe('sse_run_duration', Date.now() - startedAt);
        if (!closed) {
          res.write(sseFrame('done', {
            sessionId: pathSessionId,
            answer: result.answer,
            sql: result.sql ?? null,
            data: result.data ?? null,
            events: result.events,
            toolCalls: [],
            durationMs: result.durationMs,
            messageId: result.messageId ?? null,
            error: null,
          }));
        }
      } catch (err) {
        if (!closed) {
          res.write(sseFrame('error', uiEvent('error', '服务错误', String(err?.message ?? err))));
        }
      } finally {
        if (!closed) res.end();
      }
      return;
    }

    send(404, { error: 'not found' });
  };
}

export async function startServer({ config, store, service, metrics = null, listen = true }) {
  const handler = createHandler({ config, store, service, metrics });
  const server = createServer(handler);
  if (listen) {
    await new Promise((resolve) => server.listen(config.port, config.bindHost, resolve));
  }
  return server;
}

// 按配置选择会话存储：pg（生产多副本共享）| jsonl（本地开发默认）
export function buildStore(config) {
  if (config.sessionBackend === 'pg') return createPgSessionStore(config.db);
  return createSessionStore(config.dataDir);
}

// 直接运行入口
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  // 错误追踪（可选）：配置 SENTRY_DSN 即启用
  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'production' });
    console.log('Sentry error tracking enabled');
  }
  const config = loadConfig();
  const store = buildStore(config);
  if (store.ensureSchema) await store.ensureSchema();
  const { service, metrics } = createAppService({ config, store });
  const server = createServer(createHandler({ config, store, service, metrics }));
  server.listen(config.port, config.bindHost, () => {
    console.log(`pi-orchestrator listening on http://127.0.0.1:${config.port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

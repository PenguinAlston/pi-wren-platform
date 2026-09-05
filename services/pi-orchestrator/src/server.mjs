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
import { createSessionStore } from './sessions.mjs';
import { createAskDataTool } from './tools/ask_data.mjs';
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
  return models.getModel('pi-llm', config.openaiModel);
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

export function createAppService({ config, store, createAgent = null }) {
  if (createAgent) {
    return createAgentService({ config, model: 'stub', tools: [createAskDataTool(config)], store, createAgent });
  }
  const credentialsModel = buildModel(config);
  const service = createAgentService({
    config,
    model: credentialsModel,
    tools: [createAskDataTool(config)],
    store,
    createAgent: (args) => createPiAgent({ ...args, streamFn: undefined }),
  });
  return { service };
}

export function createHandler({ config, store, service }) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    // internal token 全端点强制（常量时间比较）
    const token = String(req.headers['x-internal-token'] ?? '');
    const expected = config.internalToken;
    const okToken =
      expected.length > 0 &&
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!okToken) {
      send(401, { error: 'invalid internal token' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      send(200, { status: 'ok' });
      return;
    }

    const userKey = safeId(req.headers['x-user-id'] ?? '', 'anonymous');
    const pathSessionId = url.pathname.split('/')[2] ?? '';

    if (req.method === 'GET' && url.pathname === '/sessions') {
      send(200, { sessions: await store.list(userKey) });
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

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
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
        });
        if (!closed) {
          res.write(sseFrame('done', {
            sessionId: pathSessionId,
            answer: result.answer,
            sql: null,
            data: result.data ?? null,
            events: result.events,
            toolCalls: [],
            durationMs: result.durationMs,
            messageId: null,
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

export async function startServer({ config, store, service, listen = true }) {
  const handler = createHandler({ config, store, service });
  const server = createServer(handler);
  if (listen) {
    await new Promise((resolve) => server.listen(config.port, '127.0.0.1', resolve));
  }
  return server;
}

// 直接运行入口
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const config = loadConfig();
  const store = createSessionStore(config.dataDir);
  const { service } = createAppService({ config, store });
  const server = createServer(createHandler({ config, store, service }));
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`pi-orchestrator listening on http://127.0.0.1:${config.port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionStore } from '../src/sessions.mjs';
import { startServer } from '../src/server.mjs';

const CONFIG = {
  internalToken: 'secret-token',
  maxToolCalls: 8,
  maxDurationMs: 175_000,
  historyTurns: 3,
  toolTimeoutMs: 120_000,
};

let server;
let baseUrl;
const stubAnswer = 'stub 回答';

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-server-'));
  const store = createSessionStore(dir);
  const config = { ...CONFIG, dataDir: dir };
  const service = {
    async run({ question, onUiEvent }) {
      onUiEvent({ id: '1', type: 'plan', label: '理解问题', detail: question, timestamp: new Date().toISOString() });
      onUiEvent({ id: '2', type: 'answer', label: '生成回答', detail: stubAnswer, timestamp: new Date().toISOString() });
      await store.appendTurn('u1', 's-abc', { question, answer: stubAnswer, at: new Date().toISOString() });
      return { answer: stubAnswer, events: [], durationMs: 1, toolCalls: 0 };
    },
  };
  server = await startServer({ config, store, service, listen: true });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function headers(extra = {}) {
  return { 'x-internal-token': 'secret-token', 'x-user-id': 'u1', ...extra };
}

describe('server auth', () => {
  it('无 token 401', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(401);
  });
  it('错误 token 401', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-internal-token': 'wrong' } });
    expect(res.status).toBe(401);
  });
  it('health 200', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: headers() });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });
});

describe('sessions endpoints', () => {
  it('list 空 → 不存在会话 404 → service 落库后可见', async () => {
    const list = await (await fetch(`${baseUrl}/sessions`, { headers: headers() })).json();
    expect(list.sessions).toEqual([]);
    const notFound = await fetch(`${baseUrl}/sessions/nope`, { headers: headers() });
    expect(notFound.status).toBe(404);
  });

  it('SSE 消息落库后会话列表与详情可查', async () => {
    const res = await fetch(`${baseUrl}/sessions/s-abc/messages`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '各险种赔付率？' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: plan');
    expect(text).toContain('event: done');
    const doneFrame = text.split('\n\n').find((f) => f.startsWith('event: done'));
    const payload = JSON.parse(doneFrame.match(/^data: (.+)$/m)[1]);
    expect(payload.answer).toBe(stubAnswer);
    expect(payload.sessionId).toBe('s-abc');
    expect(payload.messageId).toBeNull();

    const list = await (await fetch(`${baseUrl}/sessions`, { headers: headers() })).json();
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0].id).toBe('s-abc');

    const detail = await (await fetch(`${baseUrl}/sessions/s-abc`, { headers: headers() })).json();
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0].role).toBe('user');

    const del = await fetch(`${baseUrl}/sessions/s-abc`, { method: 'DELETE', headers: headers() });
    expect(del.status).toBe(200);
    expect((await (await fetch(`${baseUrl}/sessions`, { headers: headers() })).json()).sessions).toHaveLength(0);
  });

  it('空消息 400', async () => {
    const res = await fetch(`${baseUrl}/sessions/s-abc/messages`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { PiSessionStore } from '@pi-wren/pi-bridge';
import { createApp } from './app';
import { loadConfig } from './config';
import type { ApiDeps } from './deps';

const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
const logger = pino({ level: 'silent' });

let tempDir: string;
let sessions: PiSessionStore;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'api-sessions-'));
  sessions = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
  await sessions.save({
    sessionId: 's-1',
    question: '各险种赔付率如何？',
    answer: '重疾险 45%',
    sql: 'SELECT 1',
    data: [{ product_type: '重疾险', ratio: 45 }],
    createdAt: '2026-08-02T10:00:00.000Z',
  });
  await sessions.save({
    sessionId: 's-1',
    question: '那理赔进度呢？',
    answer: '2 笔已结案',
    createdAt: '2026-08-02T10:05:00.000Z',
  });

  const deps: ApiDeps = { config, logger, agents: [], sessions };
  const app = createApp(deps);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

describe('sessions api', () => {
  it('lists sessions with derived names', async () => {
    const response = await fetch(`${baseUrl}/api/sessions`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: { sessionId: string; name: string; messageCount: number }[];
    };
    expect(body.sessions[0]?.sessionId).toBe('s-1');
    expect(body.sessions[0]?.name).toBe('各险种赔付率如何？');
    expect(body.sessions[0]?.messageCount).toBe(2);
  });

  it('filters sessions by search keyword', async () => {
    const hit = await fetch(`${baseUrl}/api/sessions?search=${encodeURIComponent('赔付率')}`);
    const hitBody = (await hit.json()) as { sessions: { sessionId: string }[] };
    expect(hitBody.sessions).toHaveLength(1);

    const miss = await fetch(`${baseUrl}/api/sessions?search=不存在`);
    const missBody = (await miss.json()) as { sessions: unknown[] };
    expect(missBody.sessions).toHaveLength(0);
  });

  it('returns session history for review', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/s-1`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessionId: string;
      name: string;
      messages: { question: string; answer: string; data?: unknown[] }[];
    };
    expect(body.sessionId).toBe('s-1');
    expect(body.messages.map((m) => m.question)).toEqual(['各险种赔付率如何？', '那理赔进度呢？']);
    expect(body.messages[0]?.data).toEqual([{ product_type: '重疾险', ratio: 45 }]);
  });

  it('renames a session', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/s-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '季度理赔分析' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string };
    expect(body.name).toBe('季度理赔分析');

    const detail = (await fetch(`${baseUrl}/api/sessions/s-1`).then((r) => r.json())) as {
      name: string;
    };
    expect(detail.name).toBe('季度理赔分析');
  });

  it('rejects empty rename with 400', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/s-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects path-traversal session ids', async () => {
    expect((await fetch(`${baseUrl}/api/sessions/..%2Fevil`)).status).toBe(400);
    expect(
      (await fetch(`${baseUrl}/api/sessions/..%2F..%2Fx`, { method: 'DELETE' })).status,
    ).toBe(400);
  });

  it('deletes a session', async () => {
    const response = await fetch(`${baseUrl}/api/sessions/s-1`, { method: 'DELETE' });
    expect(response.status).toBe(204);

    const after = (await fetch(`${baseUrl}/api/sessions`).then((r) => r.json())) as {
      sessions: unknown[];
    };
    expect(after.sessions).toHaveLength(0);
    expect((await fetch(`${baseUrl}/api/sessions/s-1`)).status).toBe(404);
  });
});

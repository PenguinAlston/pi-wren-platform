import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideCompaction, estimateHistoryTokens } from './compaction';
import { PiSessionStore } from './session-store';
import { formatSseEvent, formatSseDone } from './sse';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pi-bridge-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function record(sessionId: string, question: string, answer: string, createdAt: string) {
  return { sessionId, question, answer, createdAt };
}

describe('PiSessionStore', () => {
  it('persists records to pi jsonl sessions and reads them back', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    await store.save(
      record('s-1', '王大力有哪些保单？', '1 份惠民百万医疗险', '2026-08-02T10:00:00.000Z'),
    );

    const got = await store.get('s-1');
    expect(got?.question).toBe('王大力有哪些保单？');
    expect(got?.answer).toBe('1 份惠民百万医疗险');
    expect((await store.list()).length).toBe(1);
  });

  it('supports multi-turn history ordered by time', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    await store.save(record('s-2', '第一问', '答一', '2026-08-02T10:00:00.000Z'));
    await store.save(record('s-2', '第二问', '答二', '2026-08-02T10:01:00.000Z'));

    const history = await store.getHistory('s-2');
    expect(history.map((r) => r.question)).toEqual(['第一问', '第二问']);
    expect((await store.get('s-2'))?.answer).toBe('答二');
  });

  it('is reusable across store instances (real disk persistence)', async () => {
    const sessionsRoot = join(tempDir, 'sessions');
    const first = new PiSessionStore({ cwd: tempDir, sessionsRoot });
    await first.save(record('s-3', '持久化问题', '持久化答案', '2026-08-02T10:00:00.000Z'));

    const second = new PiSessionStore({ cwd: tempDir, sessionsRoot });
    const got = await second.get('s-3');
    expect(got?.answer).toBe('持久化答案');
  });
});

describe('compaction helpers', () => {
  it('estimates history tokens and decides compaction', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      record('s-1', `问题 ${i}`, `答案 ${i} 一些较长的内容`.repeat(20), `2026-08-02T10:0${i}:00.000Z`),
    );
    const tokens = estimateHistoryTokens(records);
    expect(tokens).toBeGreaterThan(0);

    const decision = decideCompaction(records, 10_000);
    expect(decision.contextTokens).toBe(tokens);
    expect(typeof decision.shouldCompact).toBe('boolean');
  });
});

describe('SSE formatting', () => {
  it('formats agent events and done frames', () => {
    const event = {
      id: 'evt-1',
      type: 'tool_call' as const,
      label: '生成 SQL',
      detail: 'SELECT 1',
      timestamp: '2026-08-02T10:00:00.000Z',
    };
    const frame = formatSseEvent(event);
    expect(frame).toContain('event: tool_call');
    expect(frame).toContain('"label":"生成 SQL"');
    expect(frame.endsWith('\n\n')).toBe(true);

    const done = formatSseDone({
      sessionId: 's-1',
      answer: 'ok',
      trace: [],
      events: [],
      toolCalls: [],
      durationMs: 1,
    });
    expect(done).toContain('event: done');
    expect(done).toContain('"sessionId":"s-1"');
  });
});

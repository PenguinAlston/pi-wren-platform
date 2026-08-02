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

describe('PiSessionStore session management', () => {
  it('lists sessions with derived names and message counts', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    await store.save(record('s-10', '王大力有哪些保单？', '1 份惠民百万医疗险', '2026-08-02T10:00:00.000Z'));
    await store.save(record('s-10', '那理赔情况呢？', '2 笔已结案', '2026-08-02T10:05:00.000Z'));
    await store.save(record('s-11', '各险种赔付率如何？', '重疾险 45%', '2026-08-02T09:00:00.000Z'));

    const summaries = await store.listSessions();
    expect(summaries).toHaveLength(2);
    const first = summaries.find((s) => s.sessionId === 's-10');
    expect(first?.name).toBe('王大力有哪些保单？');
    expect(first?.messageCount).toBe(2);
    expect(first?.updatedAt).toBe('2026-08-02T10:05:00.000Z');
    // 按最近更新倒序
    expect(summaries[0]?.sessionId).toBe('s-10');
  });

  it('renames a session and keeps the title across instances', async () => {
    const sessionsRoot = join(tempDir, 'sessions');
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot });
    await store.save(record('s-12', '原始提问内容', '答案', '2026-08-02T10:00:00.000Z'));
    await store.renameSession('s-12', '季度理赔分析');

    const reopened = new PiSessionStore({ cwd: tempDir, sessionsRoot });
    const session = await reopened.getSession('s-12');
    expect(session?.name).toBe('季度理赔分析');
    expect(session?.records.map((r) => r.question)).toEqual(['原始提问内容']);
  });

  it('getSession returns undefined for missing or invalid ids', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    expect(await store.getSession('nope')).toBeUndefined();
    expect(await store.getSession('../../evil')).toBeUndefined();
  });

  it('deletes a session and its file', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    await store.save(record('s-13', '要删除的会话', '答案', '2026-08-02T10:00:00.000Z'));
    expect(await store.deleteSession('s-13')).toBe(true);
    expect(await store.deleteSession('s-13')).toBe(false);
    expect(await store.getHistory('s-13')).toEqual([]);
    expect(await store.listSessions()).toHaveLength(0);
    // 无效 id 不删除
    expect(await store.deleteSession('../evil')).toBe(false);
  });

  it('defaults long session names to truncated question', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    const longQuestion = '这是一段非常非常非常非常非常非常非常非常长的提问内容超过三十个字符';
    await store.save(record('s-14', longQuestion, '答案', '2026-08-02T10:00:00.000Z'));
    const summaries = await store.listSessions();
    expect(summaries[0]?.name.length).toBeLessThanOrEqual(31);
  });
});

describe('PiSessionStore sessionId hardening', () => {
  it('rejects path-traversal session ids on save', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    await expect(
      store.save(record('../../etc/pwned', 'q', 'a', '2026-08-02T10:00:00.000Z')),
    ).rejects.toThrow(/invalid sessionId/);
    await expect(
      store.save(record('a/b', 'q', 'a', '2026-08-02T10:00:00.000Z')),
    ).rejects.toThrow(/invalid sessionId/);
  });

  it('getHistory ignores invalid session ids', async () => {
    const store = new PiSessionStore({ cwd: tempDir, sessionsRoot: join(tempDir, 'sessions') });
    expect(await store.getHistory('../../evil')).toEqual([]);
  });
});

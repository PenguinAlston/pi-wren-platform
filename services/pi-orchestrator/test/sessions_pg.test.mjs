import { describe, expect, it, vi } from 'vitest';
import { createPgSessionStore } from '../src/sessions_pg.mjs';

/** 假 pool：按调用顺序返回预设结果，记录 SQL/参数。 */
function fakePool(responses) {
  const calls = [];
  const pool = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' '), params });
      const next = responses.shift();
      return next ?? { rows: [], rowCount: 0 };
    }),
  };
  return { pool, calls };
}

const DB = { host: 'pg', port: 5432, user: 'demo', password: 'demo', database: 'piwren' };

describe('pg session store', () => {
  it('ensureSchema 执行 DDL', async () => {
    const { pool, calls } = fakePool([{ rows: [], rowCount: 0 }]);
    const store = createPgSessionStore(DB, pool);
    await store.ensureSchema();
    expect(calls[0].sql).toContain('CREATE TABLE IF NOT EXISTS pi_session_turn');
  });

  it('appendTurn 参数映射', async () => {
    const { pool, calls } = fakePool([{ rows: [], rowCount: 1 }]);
    const store = createPgSessionStore(DB, pool);
    await store.appendTurn('u1', 's1', { question: 'q', answer: 'a', sql: 'SELECT 1', data: [{ x: 1 }], at: '2026-09-06T00:00:00Z' });
    expect(calls[0].sql).toContain('INSERT INTO pi_session_turn');
    expect(calls[0].params[0]).toBe('u1');
    expect(calls[0].params[1]).toBe('s1');
    expect(calls[0].params[5]).toBe(JSON.stringify([{ x: 1 }]));
  });

  it('list：搜索参数与结果映射', async () => {
    const rows = [{ sessionId: 's1', name: '各险种赔付率', updatedAt: '2026-09-06T00:00:00Z', turnCount: 3 }];
    const { pool, calls } = fakePool([{ rows, rowCount: 1 }]);
    const store = createPgSessionStore(DB, pool);
    const sessions = await store.list('u1', '赔付');
    expect(calls[0].params).toEqual(['u1', '赔付']);
    expect(calls[0].sql).toContain('ILIKE');
    expect(sessions[0]).toEqual({ id: 's1', name: '各险种赔付率', updatedAt: '2026-09-06T00:00:00.000Z', turnCount: 3 });
  });

  it('get：turns 映射为 user/assistant 消息对', async () => {
    const rows = [
      { question: 'q1', answer: 'a1', sql_text: 'SELECT 1', data_json: [{ x: 1 }], created_at: '2026-09-06T00:00:00Z' },
      { question: 'q2', answer: 'a2', sql_text: null, data_json: null, created_at: '2026-09-06T00:01:00Z' },
    ];
    const { pool } = fakePool([{ rows, rowCount: 2 }]);
    const store = createPgSessionStore(DB, pool);
    const session = await store.get('u1', 's1');
    expect(session.name).toBe('q1');
    expect(session.messages).toHaveLength(4);
    expect(session.messages[1]).toMatchObject({ role: 'assistant', sql: 'SELECT 1', data: [{ x: 1 }] });
  });

  it('history：最近 N 轮', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      question: `q${i}`, answer: `a${i}`, sql_text: null, data_json: null, created_at: '2026-09-06T00:00:00Z',
    }));
    const { pool } = fakePool([{ rows, rowCount: 5 }]);
    const store = createPgSessionStore(DB, pool);
    const history = await store.history('u1', 's1', 2);
    expect(history.map((h) => h.question)).toEqual(['q3', 'q4']);
  });

  it('路径穿越被拒绝（与 JSONL 存储同规）', async () => {
    const { pool } = fakePool([]);
    const store = createPgSessionStore(DB, pool);
    await expect(store.appendTurn('u1', '../evil', { question: 'x', answer: 'y', at: '' })).rejects.toThrow('invalid sessionId');
  });
});

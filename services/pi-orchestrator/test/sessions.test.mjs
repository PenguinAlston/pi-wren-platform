import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionStore } from '../src/sessions.mjs';

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-sessions-'));
  return createSessionStore(dir);
}

describe('session store', () => {
  it('append → list → get → history → remove', async () => {
    const store = await tempStore();
    await store.appendTurn('u1', 's1', { question: '各险种赔付率？', answer: '答案是…', sql: 'SELECT 1', at: '2026-09-05T10:00:00Z' });
    await store.appendTurn('u1', 's1', { question: '那理赔呢？', answer: '理赔情况…', at: '2026-09-05T10:01:00Z' });

    const list = await store.list('u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('s1');
    expect(list[0].name).toBe('各险种赔付率？');

    const session = await store.get('u1', 's1');
    expect(session.messages).toHaveLength(4);
    expect(session.messages[1].sql).toBe('SELECT 1');

    const history = await store.history('u1', 's1', 3);
    expect(history).toHaveLength(2);
    expect(history[1].question).toBe('那理赔呢？');

    await store.remove('u1', 's1');
    expect(await store.get('u1', 's1')).toBeNull();
    expect(await store.list('u1')).toHaveLength(0);
  });

  it('路径穿越被拒绝', async () => {
    const store = await tempStore();
    await expect(store.appendTurn('u1', '../evil', { question: 'x', answer: 'y', at: '' })).rejects.toThrow('invalid sessionId');
    await expect(store.get('../../etc', 'passwd')).rejects.toThrow('invalid user');
  });

  it('空列表与不存在会话', async () => {
    const store = await tempStore();
    expect(await store.list('nobody')).toEqual([]);
    expect(await store.get('nobody', 'nope')).toBeNull();
  });

  it('搜索按名称/会话 id 子串过滤（大小写不敏感）', async () => {
    const store = await tempStore();
    await store.appendTurn('u1', 's1', { question: '各险种赔付率如何', answer: 'a', at: '2026-09-05T10:00:00Z' });
    await store.appendTurn('u1', 's2', { question: '列出所有保单', answer: 'b', at: '2026-09-05T10:01:00Z' });
    await store.appendTurn('u1', 'abc123', { question: '核保结论', answer: 'c', at: '2026-09-05T10:02:00Z' });

    expect((await store.list('u1', '赔付')).map((s) => s.id)).toEqual(['s1']);
    expect((await store.list('u1', '保单')).map((s) => s.id)).toEqual(['s2']);
    expect((await store.list('u1', 'ABC')).map((s) => s.id)).toEqual(['abc123']); // id 匹配
    expect(await store.list('u1', '')).toHaveLength(3); // 空 = 不过滤
    expect(await store.list('u1', '不存在的关键词')).toEqual([]);
  });
});

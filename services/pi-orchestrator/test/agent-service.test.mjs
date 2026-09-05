import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentService } from '../src/agent-service.mjs';
import { createSessionStore } from '../src/sessions.mjs';

const CONFIG = { maxToolCalls: 8, maxDurationMs: 175_000, historyTurns: 3 };

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-svc-'));
  return createSessionStore(dir);
}

describe('agent service', () => {
  it('一轮运行：事件顺序、文本累积、历史持久化', async () => {
    const store = await tempStore();
    const svc = createAgentService({
      config: CONFIG, model: 'stub', tools: [], store,
      createAgent: ({ onPiEvent }) => ({
        async prompt() {
          onPiEvent({ type: 'tool_execution_start', toolName: 'ask_data', args: {} });
          onPiEvent({ type: 'tool_execution_end' });
          onPiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '最终回答' } });
        },
        subscribe() {},
      }),
    });

    const ui = [];
    const result = await svc.run({ userKey: 'u1', sessionId: 's1', question: '赔付率？', onUiEvent: (e) => ui.push(e.type) });

    expect(ui).toEqual(['plan', 'tool_call', 'tool_result', 'answer']);
    expect(result.answer).toBe('最终回答');
    expect(result.toolCalls).toBe(0); // stub 未走 guard 包装的 execute
    const history = await store.history('u1', 's1', 3);
    expect(history).toHaveLength(1);
    expect(history[0].answer).toBe('最终回答');
  });

  it('第二轮注入历史（系统提示词含上一轮）', async () => {
    const store = await tempStore();
    const seen = [];
    const svc = createAgentService({
      config: CONFIG, model: 'stub', tools: [], store,
      createAgent: ({ systemPrompt }) => ({
        async prompt() {
          seen.push(systemPrompt);
          onPiText();
          function onPiText() {}
        },
        subscribe() {},
      }),
    });
    await svc.run({ userKey: 'u1', sessionId: 's2', question: '第一问', onUiEvent: () => {} });
    await svc.run({ userKey: 'u1', sessionId: 's2', question: '第二问', onUiEvent: () => {} });
    expect(seen[0]).not.toContain('第一问');
    expect(seen[1]).toContain('第一问');
  });

  it('prompt 抛错 → error 事件 + 兜底回答，不抛出', async () => {
    const store = await tempStore();
    const svc = createAgentService({
      config: CONFIG, model: 'stub', tools: [], store,
      createAgent: () => ({ prompt: () => Promise.reject(new Error('LLM 429')), subscribe() {} }),
    });
    const ui = [];
    const result = await svc.run({ userKey: 'u1', sessionId: 's3', question: 'q', onUiEvent: (e) => ui.push(e.type) });
    expect(ui).toContain('error');
    expect(result.answer).toContain('处理失败');
  });

  it('prompt 挂起 → 超时护栏触发', async () => {
    const store = await tempStore();
    const svc = createAgentService({
      config: { ...CONFIG, maxDurationMs: 20 }, model: 'stub', tools: [], store,
      createAgent: () => ({ prompt: () => new Promise(() => {}), subscribe() {} }),
    });
    const ui = [];
    const result = await svc.run({ userKey: 'u1', sessionId: 's4', question: 'q', onUiEvent: (e) => ui.push(e.type) });
    expect(ui).toContain('error');
    expect(result.answer).toContain('超时');
  });
});

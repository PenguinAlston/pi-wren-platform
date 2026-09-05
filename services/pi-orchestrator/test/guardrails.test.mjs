import { describe, expect, it } from 'vitest';
import { createGuardrails, withTimeout } from '../src/guardrails.mjs';

describe('guardrails', () => {
  it('工具次数上限', () => {
    const g = createGuardrails({ maxToolCalls: 2 });
    expect(g.registerToolCall()).toBe(true);
    expect(g.registerToolCall()).toBe(true);
    expect(g.registerToolCall()).toBe(false);
    expect(g.toolCalls).toBe(3);
  });
  it('时长判定', async () => {
    const g = createGuardrails({ maxDurationMs: 20 });
    expect(g.expired).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(g.expired).toBe(true);
    expect(g.elapsedMs).toBeGreaterThanOrEqual(20);
  });
});

describe('withTimeout', () => {
  it('按时完成返回原值', async () => {
    expect(await withTimeout(Promise.resolve(42), 100, () => new Error('x'))).toBe(42);
  });
  it('超时 reject 自定义错误', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 10, () => new Error('超时')),
    ).rejects.toThrow('超时');
  });
});

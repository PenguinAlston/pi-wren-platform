import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@pi-wren/shared-types';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import type { WrenCli } from '@pi-wren/context-engine';
import { WrenCliContextEngine } from './wren-cli-context-engine';

function makeModel(respondWith: (messages: ChatMessage[]) => string): ModelProvider {
  return {
    name: 'mock',
    chat: async (messages: ChatMessage[]) => ({
      role: 'assistant',
      content: respondWith(messages),
    }),
  };
}

function makeCli(overrides: Partial<WrenCli> = {}): WrenCli {
  return {
    fetchInstructions: vi.fn(async () => '# 保险业务规则\n- 保单状态：02-承保有效'),
    fetchContext: vi.fn(async () => '### Model: ins_policy_main\n  - policy_no (VARCHAR)'),
    dryRun: vi.fn(async (sql: string) => ({ ok: !/DROP/i.test(sql), error: undefined })),
    ...overrides,
  } as unknown as WrenCli;
}

describe('WrenCliContextEngine', () => {
  it('injects wren instructions and memory context into the LLM prompt', async () => {
    const captured: ChatMessage[][] = [];
    const model = makeModel((messages) => {
      captured.push(messages);
      return 'SELECT COUNT(*) FROM ins_policy_main;';
    });
    const engine = new WrenCliContextEngine({ model, cli: makeCli() });

    await engine.generateSQL('赔付率是多少？');

    const prompt = captured[0]?.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain('# 保险业务规则');
    expect(prompt).toContain('### Model: ins_policy_main');
    expect(prompt).toContain('赔付率是多少？');
  });

  it('passes dry-run and returns the LLM SQL', async () => {
    const model = makeModel(() => 'SELECT COUNT(*) FROM ins_policy_main;');
    const engine = new WrenCliContextEngine({ model, cli: makeCli() });

    expect(await engine.generateSQL('多少保单')).toContain('COUNT(*)');
  });

  it('throws when wren dry-run rejects the generated SQL (no fallback)', async () => {
    const model = makeModel(() => 'DROP TABLE ins_policy_main');
    const engine = new WrenCliContextEngine({ model, cli: makeCli() });

    await expect(engine.generateSQL('危险问题')).rejects.toThrow(/dry-run rejected/);
  });

  it('propagates the error when the LLM call throws (no fallback)', async () => {
    const model: ModelProvider = {
      name: 'mock',
      chat: async () => {
        throw new Error('LLM unavailable');
      },
    };
    const engine = new WrenCliContextEngine({ model, cli: makeCli() });

    await expect(engine.generateSQL('任何问题')).rejects.toThrow('LLM unavailable');
  });

  it('returns empty metric list and undefined lookup', async () => {
    const engine = new WrenCliContextEngine({ model: makeModel(() => 'SELECT 1'), cli: makeCli() });
    expect(await engine.listMetrics()).toEqual([]);
    expect(await engine.getMetric('claim_count')).toBeUndefined();
  });

  it('uses wren search context for knowledge lookup', async () => {
    const engine = new WrenCliContextEngine({ model: makeModel(() => 'SELECT 1'), cli: makeCli() });
    const knowledge = await engine.searchKnowledge('赔付');
    expect(knowledge.join('\n')).toContain('ins_policy_main');
  });

  it('returns empty knowledge when wren fetch yields nothing', async () => {
    const cli = makeCli({ fetchContext: vi.fn(async () => ''), fetchInstructions: vi.fn(async () => '') });
    const engine = new WrenCliContextEngine({ model: makeModel(() => 'SELECT 1'), cli });
    expect(await engine.searchKnowledge('赔付')).toEqual([]);
  });
});

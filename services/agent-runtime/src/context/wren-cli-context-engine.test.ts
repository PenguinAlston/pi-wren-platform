import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@pi-wren/shared-types';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import type { ContextEngine, SemanticConfig } from '@pi-wren/context-engine';
import type { WrenCli } from '@pi-wren/context-engine';
import { WrenCliContextEngine } from './wren-cli-context-engine';

const config: SemanticConfig = {
  name: 'test',
  models: [{ name: 'ins_policy_main', table: 'ins_policy_main' }],
  intents: [],
  metrics: [],
  knowledge: [],
};

const fallback: ContextEngine = {
  generateSQL: async () => 'SELECT COUNT(*) FROM ins_policy_main;',
  searchKnowledge: async (q) => [`fallback knowledge: ${q}`],
  getMetric: async (name) => ({ name, definition: 'fallback' }),
  listMetrics: async () => [],
};

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
    const engine = new WrenCliContextEngine({ model, cli: makeCli(), config, fallback });

    await engine.generateSQL('赔付率是多少？');

    const prompt = captured[0]?.map((m) => m.content).join('\n') ?? '';
    expect(prompt).toContain('# 保险业务规则');
    expect(prompt).toContain('### Model: ins_policy_main');
    expect(prompt).toContain('赔付率是多少？');
  });

  it('passes dry-run and returns the LLM SQL', async () => {
    const model = makeModel(() => 'SELECT COUNT(*) FROM ins_policy_main;');
    const engine = new WrenCliContextEngine({ model, cli: makeCli(), config, fallback });

    expect(await engine.generateSQL('多少保单')).toContain('COUNT(*)');
  });

  it('falls back when wren dry-run rejects the generated SQL', async () => {
    const model = makeModel(() => 'DROP TABLE ins_policy_main');
    const engine = new WrenCliContextEngine({ model, cli: makeCli(), config, fallback });

    expect(await engine.generateSQL('危险问题')).toContain('COUNT(*)');
  });

  it('falls back when the LLM call throws', async () => {
    const model: ModelProvider = {
      name: 'mock',
      chat: async () => {
        throw new Error('LLM unavailable');
      },
    };
    const engine = new WrenCliContextEngine({ model, cli: makeCli(), config, fallback });

    expect(await engine.generateSQL('任何问题')).toContain('COUNT(*)');
  });

  it('delegates metric lookups to the fallback', async () => {
    const engine = new WrenCliContextEngine({ model: makeModel(() => 'SELECT 1'), cli: makeCli(), config, fallback });
    expect(await engine.listMetrics()).toEqual([]);
    expect(await engine.getMetric('claim_count')).toEqual({ name: 'claim_count', definition: 'fallback' });
  });

  it('uses wren search context for knowledge lookup', async () => {
    const engine = new WrenCliContextEngine({ model: makeModel(() => 'SELECT 1'), cli: makeCli(), config, fallback });
    const knowledge = await engine.searchKnowledge('赔付');
    expect(knowledge.join('\n')).toContain('ins_policy_main');
  });
});

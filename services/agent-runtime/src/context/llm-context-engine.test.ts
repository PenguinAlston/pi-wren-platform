import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@pi-wren/shared-types';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import type { ContextEngine, SemanticConfig } from '@pi-wren/context-engine';
import { LlmContextEngine } from './llm-context-engine';

const config: SemanticConfig = {
  name: 'test',
  models: [{ name: 'ins_policy_main', table: 'ins_policy_main' }],
  intents: [
    {
      name: 'overview',
      keywords: ['保费'],
      sql: 'SELECT product_type, SUM(year_premium) FROM ins_policy_main GROUP BY product_type;',
    },
  ],
  metrics: [],
  knowledge: ['保单状态：02-承保有效'],
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

describe('LlmContextEngine', () => {
  it('uses the LLM SQL when it is valid', async () => {
    const model = makeModel(
      () => 'SELECT COUNT(*) FROM ins_policy_main WHERE year_premium > 5000;',
    );
    const engine = new LlmContextEngine({ model, config, fallback });

    expect(await engine.generateSQL('保费超过5000的保单有多少')).toContain(
      'WHERE year_premium > 5000',
    );
  });

  it('falls back when the LLM returns a dangerous statement', async () => {
    const model = makeModel(() => 'DELETE FROM ins_policy_main');
    const engine = new LlmContextEngine({ model, config, fallback });

    expect(await engine.generateSQL('危险问题')).toContain('COUNT(*)');
  });

  it('falls back when the LLM call throws', async () => {
    const model: ModelProvider = {
      name: 'mock',
      chat: async () => {
        throw new Error('LLM unavailable');
      },
    };
    const engine = new LlmContextEngine({ model, config, fallback });

    expect(await engine.generateSQL('任何问题')).toContain('COUNT(*)');
  });

  it('includes schema context and examples in the prompt', async () => {
    let prompt = '';
    const model = makeModel((messages) => {
      prompt = messages.at(-1)?.content ?? '';
      return 'SELECT 1 FROM ins_policy_main;';
    });
    const engine = new LlmContextEngine({ model, config, fallback });
    await engine.generateSQL('保费规模');

    expect(prompt).toContain('ins_policy_main');
    expect(prompt).toContain('保费');
    expect(prompt).toContain('保单状态');
  });

  it('delegates knowledge and metric lookups to the fallback', async () => {
    const model = makeModel(() => 'SELECT 1;');
    const engine = new LlmContextEngine({ model, config, fallback });

    expect((await engine.searchKnowledge('核保'))[0]).toContain('fallback knowledge');
    expect((await engine.getMetric('x'))?.definition).toBe('fallback');
    expect(await engine.listMetrics()).toEqual([]);
  });
});

describe('LlmContextEngine detail guidance (P1)', () => {
  it('instructs the LLM to select detail columns and JOIN customer table', async () => {
    let systemPrompt = '';
    const model = makeModel((messages) => {
      systemPrompt = messages.at(0)?.content ?? '';
      return 'SELECT 1 FROM ins_policy_main;';
    });
    const engine = new LlmContextEngine({ model, config, fallback });

    await engine.generateSQL('2025终止的保单有哪些？同时告诉我被保人的姓名和保单号码');

    expect(systemPrompt).toContain('ins_customer');
    expect(systemPrompt).toContain('SELECT those columns');
  });

  it('prefers detail intents as examples for detail questions', async () => {
    const detailConfig: SemanticConfig = {
      name: 'test',
      models: [{ name: 'ins_policy_main', table: 'ins_policy_main' }],
      intents: [
        {
          name: 'overview',
          keywords: ['保费'],
          kind: 'aggregate',
          sql: 'SELECT product_type, SUM(year_premium) FROM ins_policy_main GROUP BY product_type;',
        },
        {
          name: 'policy_terminated_detail',
          keywords: ['已终止'],
          kind: 'detail',
          sql: "SELECT p.policy_no FROM ins_policy_main p WHERE p.policy_status = '05';",
        },
      ],
      metrics: [],
      knowledge: [],
    };
    let prompt = '';
    const model = makeModel((messages) => {
      prompt = messages.at(-1)?.content ?? '';
      return 'SELECT 1;';
    });
    const engine = new LlmContextEngine({ model, config: detailConfig, fallback });
    await engine.generateSQL('已终止的保单有哪些？');

    const exampleStart = prompt.indexOf('Examples of question -> SQL:');
    const examples = prompt.slice(exampleStart);
    // 示例标签取 keywords[0]：明细意图('已终止')应排在聚合意图('保费')之前
    expect(examples.indexOf('已终止')).toBeGreaterThan(-1);
    expect(examples.indexOf('已终止')).toBeLessThan(examples.indexOf('保费'));
  });
});

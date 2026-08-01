import { describe, expect, it } from 'vitest';
import { ConfigDrivenContextEngine } from './config-context';
import type { SemanticConfig } from './types';

const config: SemanticConfig = {
  name: 'insurance',
  models: [{ name: 'policy', table: 'insurance_policy' }],
  intents: [
    {
      name: 'claim_ratio',
      keywords: ['赔付率', '理赔'],
      sql: 'SELECT product_name, SUM(paid_amount) AS paid FROM insurance_claim;',
    },
    {
      name: 'overview',
      keywords: ['概览'],
      sql: 'SELECT COUNT(*) AS cnt FROM insurance_policy;',
    },
  ],
  metrics: [
    { name: 'claim_ratio', definition: '已决赔款 / 已赚保费', unit: '%' },
    { name: 'active_policies', definition: '在保保单数量' },
  ],
  knowledge: ['赔付率超过 70% 属于高风险信号'],
  defaultIntent: 'overview',
};

describe('ConfigDrivenContextEngine', () => {
  const engine = new ConfigDrivenContextEngine(config);

  it('matches intents by Chinese keywords', async () => {
    expect(await engine.generateSQL('各险种赔付率如何？')).toContain('insurance_claim');
    expect(await engine.generateSQL('理赔案件进度')).toContain('insurance_claim');
  });

  it('falls back to the default intent when nothing matches', async () => {
    expect(await engine.generateSQL('随便聊聊')).toContain('insurance_policy');
  });

  it('lists and looks up metric definitions', async () => {
    const metrics = await engine.listMetrics();
    expect(metrics).toHaveLength(2);

    const claimRatio = await engine.getMetric('claim_ratio');
    expect(claimRatio?.definition).toContain('已赚保费');
    expect(await engine.getMetric('nope')).toBeUndefined();
  });

  it('retrieves relevant knowledge', async () => {
    const results = await engine.searchKnowledge('赔付率 风险');
    expect(results.join(' ')).toContain('高风险');
  });
});

describe('ConfigDrivenContextEngine intent scoring', () => {
  it('prefers the intent with more keyword hits', async () => {
    const scoringConfig: SemanticConfig = {
      name: 'insurance',
      models: [{ name: 'policy', table: 'insurance_policy' }],
      intents: [
        { name: 'claim_ratio', keywords: ['理赔'], sql: 'SELECT claim_amount FROM claim;' },
        { name: 'claim_status', keywords: ['案件', '进度', '理赔状态'], sql: 'SELECT status FROM claim;' },
        { name: 'overview', keywords: ['概览'], sql: 'SELECT 1;' },
      ],
      metrics: [],
      knowledge: [],
      defaultIntent: 'overview',
    };
    const engine = new ConfigDrivenContextEngine(scoringConfig);
    // “理赔”命中 claim_ratio(1)，但“案件/进度”命中 claim_status(2)，评分更高者胜出
    expect(await engine.generateSQL('理赔案件的进度如何？')).toBe('SELECT status FROM claim;');
  });
});

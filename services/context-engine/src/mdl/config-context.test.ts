import { describe, expect, it } from 'vitest';
import { ConfigDrivenContextEngine } from './config-context';
import { loadSemanticConfig, resolveSemanticFile } from './loader';
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
        {
          name: 'claim_status',
          keywords: ['案件', '进度', '理赔状态'],
          sql: 'SELECT status FROM claim;',
        },
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

describe('ConfigDrivenContextEngine insurance detail intents (P0 badcase)', () => {
  const insuranceConfig = loadSemanticConfig(resolveSemanticFile('insurance.mdl.yml'));

  it('generates detail SQL with insured name + policy number for the original badcase question', async () => {
    const engine = new ConfigDrivenContextEngine(insuranceConfig);
    const sql = await engine.generateSQL('2025终止的保单有哪些？同时告诉我被保人的姓名和保单号码');

    // 必须返回明细字段而不是状态聚合
    expect(sql).toContain('policy_no');
    expect(sql).toContain('customer_name AS insured_name');
    expect(sql).not.toContain('GROUP BY');
    expect(sql).not.toContain('{year}');
    // 年份参数已渲染为 2025 区间
    expect(sql).toContain("BETWEEN '2025-01-01' AND '2025-12-31'");
    // 同时给出"已终止/到期"两种口径的标注列
    expect(sql).toContain('term_type');
  });

  it('keeps aggregate SQL for status distribution questions', async () => {
    const engine = new ConfigDrivenContextEngine(insuranceConfig);
    const sql = await engine.generateSQL('保单状态分布如何？');
    expect(sql).toContain('GROUP BY');
    expect(sql).toContain('policy_count');
  });

  it('keeps aggregate SQL for count-style questions mentioning 终止', async () => {
    const engine = new ConfigDrivenContextEngine(insuranceConfig);
    const sql = await engine.generateSQL('2025年终止的保单有多少？');
    expect(sql).toContain('GROUP BY');
  });

  it('filters terminated detail by year when the user explicitly says 已终止', async () => {
    const engine = new ConfigDrivenContextEngine(insuranceConfig);
    const sql = await engine.generateSQL('2025已终止的保单有哪些？');
    expect(sql).toContain("policy_status = '05'");
    expect(sql).toContain("BETWEEN '2025-01-01' AND '2025-12-31'");
  });

  it('lists all terminated policies when no year is given', async () => {
    const engine = new ConfigDrivenContextEngine(insuranceConfig);
    const sql = await engine.generateSQL('已终止的保单有哪些？');
    expect(sql).toContain("policy_status = '05'");
    // 无年份 → 使用 yearFallback（1=1），不残留占位符
    expect(sql).not.toContain('{year}');
    expect(sql).toContain('AND 1=1');
  });

  it('prefers the expiry intent for 到期/满期 questions with year', async () => {
    const engine = new ConfigDrivenContextEngine(insuranceConfig);
    const sql = await engine.generateSQL('2025年到期或满期的保单名单');
    expect(sql).toContain('term_type');
    expect(sql).toContain("BETWEEN '2025-01-01' AND '2025-12-31'");
  });
});

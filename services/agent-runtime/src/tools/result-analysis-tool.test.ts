import { describe, expect, it } from 'vitest';
import { analyzeQueryResult } from './result-analysis-tool';

const rows = [
  { quarter: 'Q1', revenue: 1000000, profit: 400000 },
  { quarter: 'Q2', revenue: 950000, profit: 250000 },
];

describe('analyzeQueryResult', () => {
  it('computes quarter-over-quarter observations for numeric columns', () => {
    const result = analyzeQueryResult(rows, '为什么利润下降');

    expect(result.summary).toContain('2 行');
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toContain('-5.0%');
    expect(result.observations[1]).toContain('-37.5%');
  });

  it('handles numeric values returned as strings (pg NUMERIC)', () => {
    const result = analyzeQueryResult(
      [
        { quarter: 'Q1', profit: '400000' },
        { quarter: 'Q2', profit: '250000' },
      ],
      '利润',
    );

    expect(result.observations[0]).toContain('-37.5%');
  });

  it('handles grouped category data with share observations', () => {
    const result = analyzeQueryResult(
      [
        { product_name: '车险', claim_amount: 28000, paid_amount: 28000 },
        { product_name: '重疾险', claim_amount: 200000, paid_amount: 200000 },
        { product_name: '医疗险', claim_amount: 21000, paid_amount: 15000 },
      ],
      '赔付率',
    );

    expect(result.observations.join(' ')).toContain('重疾险');
    expect(result.observations.join(' ')).toContain('占比');
  });

  it('treats dictionary code columns as labels, not numbers', () => {
    const result = analyzeQueryResult(
      [
        { product_type: '01', policy_count: '7' },
        { product_type: '04', policy_count: '2' },
        { product_type: '05', policy_count: '1' },
      ],
      '保费规模',
    );

    const joined = result.observations.join(' ');
    expect(joined).toContain('01');
    expect(joined).toContain('policy_count');
    // 代码列不应被当作数值参与占比计算
    expect(joined).not.toContain('product_type 的 policy_count');
  });

  it('handles empty results', () => {
    const result = analyzeQueryResult([], '问题');
    expect(result.summary).toContain('未返回任何数据');
  });
});

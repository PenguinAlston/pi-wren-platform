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

  it('handles empty results', () => {
    const result = analyzeQueryResult([], '问题');
    expect(result.summary).toContain('未返回任何数据');
  });
});

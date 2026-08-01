import { describe, expect, it } from 'vitest';
import { generateDemoSQL } from './demo-sql-generator';

describe('generateDemoSQL', () => {
  it('maps profit questions to the profit query', () => {
    expect(generateDemoSQL('为什么利润下降了？')).toContain('profit');
  });

  it('maps revenue questions to the revenue query', () => {
    expect(generateDemoSQL('本季度收入趋势')).toContain('revenue');
  });

  it('falls back to the full fact query for unknown questions', () => {
    expect(generateDemoSQL('随便聊聊')).toContain('finance_fact');
  });
});

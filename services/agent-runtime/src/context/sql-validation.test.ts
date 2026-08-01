import { describe, expect, it } from 'vitest';
import { parseAndValidateSql } from './sql-validation';
import type { SemanticConfig } from '@pi-wren/context-engine';

const config: SemanticConfig = {
  name: 'test',
  models: [
    { name: 'ins_policy_main', table: 'ins_policy_main', columns: [{ name: 'year_premium', type: 'numeric' }] },
    { name: 'ins_claim_main', table: 'ins_claim_main' },
  ],
  intents: [],
  metrics: [],
  knowledge: [],
};

describe('parseAndValidateSql', () => {
  it('extracts SQL from a markdown code block', () => {
    const sql = parseAndValidateSql('```sql\nSELECT * FROM ins_policy_main;\n```', config);
    expect(sql).toBe('SELECT * FROM ins_policy_main');
  });

  it('accepts plain SELECT and WITH queries', () => {
    expect(parseAndValidateSql('SELECT COUNT(*) FROM ins_policy_main', config)).toContain('SELECT');
    expect(
      parseAndValidateSql('WITH t AS (SELECT 1) SELECT * FROM t', config),
    ).toContain('WITH');
  });

  it('allows joins to declared tables and sys_dict', () => {
    const sql = parseAndValidateSql(
      'SELECT d.dict_label FROM ins_claim_main c JOIN sys_dict d ON d.dict_value = c.claim_status',
      config,
    );
    expect(sql).toContain('sys_dict');
  });

  it('rejects data-modifying statements', () => {
    expect(() => parseAndValidateSql('UPDATE ins_policy_main SET year_premium = 0', config)).toThrow(
      /高危/,
    );
    expect(() => parseAndValidateSql('DELETE FROM ins_policy_main', config)).toThrow(/高危/);
  });

  it('rejects multiple statements', () => {
    expect(() =>
      parseAndValidateSql('SELECT 1; DROP TABLE ins_policy_main', config),
    ).toThrow();
  });

  it('rejects references to undeclared tables', () => {
    expect(() => parseAndValidateSql('SELECT * FROM users', config)).toThrow(/未声明表/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseAndValidateSql } from './sql-validation';

const tables = ['ins_policy_main', 'ins_claim_main', 'sys_dict'];

describe('parseAndValidateSql', () => {
  it('extracts SQL from a markdown code block', () => {
    const sql = parseAndValidateSql('```sql\nSELECT * FROM ins_policy_main;\n```', tables);
    expect(sql).toBe('SELECT * FROM ins_policy_main');
  });

  it('accepts plain SELECT and WITH queries', () => {
    expect(parseAndValidateSql('SELECT COUNT(*) FROM ins_policy_main', tables)).toContain('SELECT');
    expect(
      parseAndValidateSql('WITH t AS (SELECT 1) SELECT * FROM t', tables),
    ).toContain('WITH');
  });

  it('allows joins to declared tables and sys_dict', () => {
    const sql = parseAndValidateSql(
      'SELECT d.dict_label FROM ins_claim_main c JOIN sys_dict d ON d.dict_value = c.claim_status',
      tables,
    );
    expect(sql).toContain('sys_dict');
  });

  it('rejects data-modifying statements', () => {
    expect(() => parseAndValidateSql('UPDATE ins_policy_main SET year_premium = 0', tables)).toThrow(
      /高危/,
    );
    expect(() => parseAndValidateSql('DELETE FROM ins_policy_main', tables)).toThrow(/高危/);
  });

  it('rejects multiple statements', () => {
    expect(() =>
      parseAndValidateSql('SELECT 1; DROP TABLE ins_policy_main', tables),
    ).toThrow();
  });

  it('rejects references to undeclared tables', () => {
    expect(() => parseAndValidateSql('SELECT * FROM users', tables)).toThrow(/未声明表/);
  });
});

describe('parseAndValidateSql adversarial cases', () => {
  it('blocks comment-obfuscated DML keywords', () => {
    // PostgreSQL 将 /* */ 视为空白，DEL/**/ETE 即 DELETE
    const evil = 'WITH x AS (DEL/**/ETE FROM ins_policy_main RETURNING *) SELECT * FROM x';
    expect(() => parseAndValidateSql(evil, tables)).toThrow(/高危/);
    expect(() => parseAndValidateSql('INS/**/ERT INTO ins_policy_main VALUES (1)', tables)).toThrow(/高危/);
  });

  it('blocks line-comment obfuscation', () => {
    expect(() => parseAndValidateSql('SELECT 1 -- note\nDELETE FROM ins_policy_main', tables)).toThrow(/高危/);
  });

  it('blocks dangerous functions (DoS / file access / backend control)', () => {
    expect(() => parseAndValidateSql('SELECT pg_sleep(3600)', tables)).toThrow(/危险函数/);
    expect(() => parseAndValidateSql("SELECT pg_read_file('/etc/passwd')", tables)).toThrow(/危险函数/);
    expect(() => parseAndValidateSql('SELECT pg_terminate_backend(42)', tables)).toThrow(/危险函数/);
    expect(() => parseAndValidateSql('SELECT pg_advisory_lock(1)', tables)).toThrow(/危险函数/);
  });

  it('allows keywords and semicolons inside string literals (no false positives)', () => {
    const sql = "SELECT * FROM ins_policy_main WHERE note = 'delete request; drop me'";
    expect(() => parseAndValidateSql(sql, tables)).not.toThrow();
  });

  it('allows dollar-quoted string content (it is a literal, not executed)', () => {
    expect(() => parseAndValidateSql('SELECT $$delete from ins_policy_main$$', tables)).not.toThrow();
  });

  it('blocks multi-statement even with string-embedded semicolons', () => {
    expect(() => parseAndValidateSql("SELECT 1; SELECT * FROM ins_policy_main", tables)).toThrow(/多条/);
  });

  it('skips table whitelist when allowedTables is absent but still blocks dangerous SQL', () => {
    // 无工程信息路径：保留 SELECT/危险检查，不校验表名
    expect(parseAndValidateSql('SELECT * FROM any_table', undefined)).toContain('SELECT');
    expect(() => parseAndValidateSql('DROP TABLE any_table', undefined)).toThrow(/高危/);
    expect(() => parseAndValidateSql('SELECT pg_sleep(1)', undefined)).toThrow(/危险函数/);
  });

  it('still enforces table whitelist for string-comment injected references', () => {
    expect(() => parseAndValidateSql("SELECT 1 -- FROM users\n", tables)).not.toThrow(); // 注释内的表名不影响
    expect(() => parseAndValidateSql('SELECT * FROM users', tables)).toThrow(/未声明表/);
  });
});

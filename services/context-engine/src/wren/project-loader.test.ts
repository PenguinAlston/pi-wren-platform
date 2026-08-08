import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allowedTablesOf, isWrenProjectReady, loadWrenProject } from './project-loader';

const POLICY_META = `name: ins_policy_main
table_reference:
  schema: public
  table: ins_policy_main
properties:
  description: 保单主表
columns:
  - name: policy_no
    type: VARCHAR
    properties:
      description: 保单号
  - name: year_premium
    type: DECIMAL
`;

const CLAIM_RATIO_MD = `---
nl: 赔付率分析（按险种汇总）
sql: |-
  SELECT d.dict_label AS product_type,
         COUNT(c.claim_id) AS claim_count
  FROM ins_claim_main c
  GROUP BY d.dict_label
source: seed
datasource: insurance-postgres
---
`;

describe('loadWrenProject', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function setup(): string {
    dir = mkdtempSync(join(tmpdir(), 'wren-project-'));
    writeFileSync(join(dir, 'wren_project.yml'), 'schema_version: 5\nname: insurance\n');
    mkdirSync(join(dir, 'models', 'ins_policy_main'), { recursive: true });
    writeFileSync(join(dir, 'models', 'ins_policy_main', 'metadata.yml'), POLICY_META);
    mkdirSync(join(dir, 'knowledge', 'sql'), { recursive: true });
    writeFileSync(join(dir, 'knowledge', 'sql', 'claim_ratio.md'), CLAIM_RATIO_MD);
    return dir;
  }

  it('detects readiness by wren_project.yml', () => {
    const ready = setup();
    expect(isWrenProjectReady(ready)).toBe(true);
    expect(isWrenProjectReady(join(ready, 'nonexistent'))).toBe(false);
  });

  it('loads models with table names, descriptions and columns', () => {
    const project = loadWrenProject(setup());
    expect(project.models).toHaveLength(1);
    const model = project.models[0]!;
    expect(model.name).toBe('ins_policy_main');
    expect(model.table).toBe('ins_policy_main');
    expect(model.description).toBe('保单主表');
    expect(model.columns).toEqual([
      { name: 'policy_no', type: 'VARCHAR', description: '保单号' },
      { name: 'year_premium', type: 'DECIMAL', description: undefined },
    ]);
  });

  it('loads NL→SQL examples from frontmatter', () => {
    const project = loadWrenProject(setup());
    expect(project.examples).toHaveLength(1);
    const example = project.examples[0]!;
    expect(example.name).toBe('claim_ratio');
    expect(example.nl).toContain('赔付率分析');
    expect(example.sql).toContain('ins_claim_main');
  });

  it('allowedTablesOf extracts lowercase table names plus sys_dict', () => {
    const project = loadWrenProject(setup());
    expect(allowedTablesOf(project)).toEqual(['ins_policy_main', 'sys_dict']);
  });

  it('returns empty arrays when the directory lacks models/knowledge', () => {
    dir = mkdtempSync(join(tmpdir(), 'wren-empty-'));
    writeFileSync(join(dir, 'wren_project.yml'), 'schema_version: 5\n');
    const project = loadWrenProject(dir);
    expect(project.models).toEqual([]);
    expect(project.examples).toEqual([]);
    expect(allowedTablesOf(project)).toEqual(['sys_dict']);
  });

  it('skips malformed metadata.yml without throwing', () => {
    const ready = setup();
    mkdirSync(join(ready, 'models', 'broken'), { recursive: true });
    writeFileSync(join(ready, 'models', 'broken', 'metadata.yml'), 'name: broken\n');
    const project = loadWrenProject(ready);
    expect(project.models.map((m) => m.name)).toEqual(['ins_policy_main']);
  });
});

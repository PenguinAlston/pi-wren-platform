/**
 * 生成 Wren 语义项目（schema_version 5 布局）到 semantic/wren/。
 * 数据源：semantic/insurance.mdl.yml（自研 MDL 式配置）。
 *
 * 用法（仓库根目录）：
 *   pnpm --filter @pi-wren/context-engine exec tsx scripts/generate-wren-project.ts
 *   # 或 npx tsx services/context-engine/scripts/generate-wren-project.ts
 *   # 可选 --out <dir> 覆盖输出目录（默认 semantic/wren）
 *
 * 生成后需在目标机执行：
 *   wren context build
 *   wren memory index   # 可选，需 HF 可达（国内设 HF_ENDPOINT=https://hf-mirror.com）
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const SRC = resolve(repoRoot, 'semantic/insurance.mdl.yml');
const OUT = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1] ?? '')
  : resolve(repoRoot, 'semantic/wren');

const TYPE_MAP: Record<string, string> = {
  varchar: 'VARCHAR',
  integer: 'INTEGER',
  numeric: 'DECIMAL',
  decimal: 'DECIMAL',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
  boolean: 'BOOLEAN',
};

const PRIMARY_KEYS: Record<string, string> = {
  ins_policy_main: 'policy_id',
  ins_claim_main: 'claim_id',
  ins_preserve_main: 'preserve_id',
  ins_policy_underwrite: 'underwrite_id',
  ins_customer: 'customer_id',
};

const mdl = parse(readFileSync(SRC, 'utf8')) as {
  name: string;
  catalog: string;
  schema: string;
  models: Array<{
    name: string;
    table: string;
    description?: string;
    columns: Array<{ name: string; type: string; label?: string }>;
  }>;
  intents: Array<{
    name: string;
    description: string;
    keywords?: string[];
    kind?: string;
    params?: string[];
    yearFallback?: string;
    sql: string;
  }>;
  metrics?: Array<{ name: string; definition: string; unit?: string }>;
  knowledge?: string[];
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(resolve(OUT, 'models'), { recursive: true });
mkdirSync(resolve(OUT, 'knowledge/rules'), { recursive: true });
mkdirSync(resolve(OUT, 'knowledge/sql'), { recursive: true });

// wren_project.yml
writeFileSync(
  resolve(OUT, 'wren_project.yml'),
  stringify({
    schema_version: 5,
    name: mdl.name,
    catalog: 'wren',
    schema: 'public',
    data_source: 'postgres',
    profile: 'insurance-db',
  }),
);

// models/<name>/metadata.yml
for (const m of mdl.models) {
  const meta: Record<string, unknown> = {
    name: m.name,
    table_reference: { schema: 'public', table: m.table },
    columns: m.columns.map((c) => ({
      name: c.name,
      type: TYPE_MAP[c.type] ?? c.type.toUpperCase(),
      properties: c.label ? { description: c.label } : undefined,
    })),
  };
  if (m.description) {
    meta.properties = { description: m.description };
  }
  if (PRIMARY_KEYS[m.name]) {
    meta.primary_key = PRIMARY_KEYS[m.name];
  }
  mkdirSync(resolve(OUT, 'models', m.name), { recursive: true });
  writeFileSync(
    resolve(OUT, 'models', m.name, 'metadata.yml'),
    stringify(meta, { defaultStringType: 'PLAIN' }),
  );
}

// relationships.yml
const relationships = [
  ['claim_policy', 'ins_claim_main', 'ins_policy_main', 'ins_claim_main.policy_id = ins_policy_main.policy_id'],
  ['preserve_policy', 'ins_preserve_main', 'ins_policy_main', 'ins_preserve_main.policy_id = ins_policy_main.policy_id'],
  ['underwrite_policy', 'ins_policy_underwrite', 'ins_policy_main', 'ins_policy_underwrite.policy_id = ins_policy_main.policy_id'],
  ['policy_insured', 'ins_policy_main', 'ins_customer', 'ins_policy_main.insured_id = ins_customer.customer_id'],
  ['policy_applicant', 'ins_policy_main', 'ins_customer', 'ins_policy_main.applicant_id = ins_customer.customer_id'],
];
writeFileSync(
  resolve(OUT, 'relationships.yml'),
  stringify({
    relationships: relationships.map(([name, from, to, condition]) => ({
      name,
      models: [from, to],
      join_type: 'MANY_TO_ONE',
      condition,
    })),
  }),
);

// knowledge/knowledge.yml
writeFileSync(resolve(OUT, 'knowledge/knowledge.yml'), stringify({ schema_version: 1 }));

// knowledge/rules/insurance.md —— 业务规则 + 指标口径
const ruleLines = ['# 保险业务规则', ''];
for (const k of mdl.knowledge ?? []) {
  ruleLines.push(`- ${k}`);
}
ruleLines.push('', '# 指标口径', '');
for (const mt of mdl.metrics ?? []) {
  ruleLines.push(`- ${mt.name}: ${mt.definition}${mt.unit ? `（单位：${mt.unit}）` : ''}`);
}
writeFileSync(resolve(OUT, 'knowledge/rules/insurance.md'), ruleLines.join('\n') + '\n');

// knowledge/sql/<intent>.md —— NL→SQL pairs
for (const it of mdl.intents) {
  let sql = it.sql.trim();
  if (sql.includes('{year}')) {
    sql = sql.replaceAll('{year}', it.yearFallback ?? '1=1');
  }
  const frontmatter = stringify(
    { nl: it.description, sql, source: 'seed', datasource: 'insurance-postgres' },
    { defaultStringType: 'PLAIN' },
  );
  writeFileSync(resolve(OUT, 'knowledge/sql', `${it.name}.md`), `---\n${frontmatter}---\n`);
}

console.log(`Wren project generated at ${OUT}`);
console.log(`  models: ${mdl.models.length}, intents: ${mdl.intents.length}`);

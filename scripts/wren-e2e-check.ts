/**
 * 端到端验证：真实 wren CLI + 真实保险库 + 真实 LLM（DashScope）。
 * 用法（仓库根）：
 *   npx tsx scripts/wren-e2e-check.ts
 */
import { readFileSync } from 'node:fs';
import { createModelProvider } from '@pi-wren/agent-sdk';
import {
  ConfigDrivenContextEngine,
  WrenCli,
  loadSemanticConfig,
} from '@pi-wren/context-engine';
import { WrenCliContextEngine } from '@pi-wren/agent-runtime';

// 手动加载 .env（不打印任何密钥）
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]!] = m[2]!;
}

const WREN_BIN = process.env.WREN_BIN ?? 'wren';
const WREN_PROJECT = process.env.WREN_PROJECT_DIR ?? 'semantic/wren';
const QUESTION = process.argv[2] ?? '按险种统计赔付率';

async function main(): Promise<void> {
  const model = createModelProvider({
    kind: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  });
  const semanticConfig = loadSemanticConfig('semantic/insurance.mdl.yml');
  const cli = new WrenCli({ bin: WREN_BIN, projectDir: WREN_PROJECT });
  const engine = new WrenCliContextEngine({
    model,
    cli,
    config: semanticConfig,
    fallback: new ConfigDrivenContextEngine(semanticConfig),
  });

  console.log(`[e2e] question: ${QUESTION}`);
  const sql = await engine.generateSQL(QUESTION);
  console.log(`[e2e] generated SQL:\n${sql}`);
  const dry = await cli.dryRun(sql);
  console.log(`[e2e] dry-run: ${dry.ok ? 'OK' : dry.error}`);
  if (dry.ok) {
    const rows = await cli.execute(sql);
    console.log(`[e2e] rows (${rows.length}):`);
    for (const r of rows.slice(0, 20)) console.log('  ', JSON.stringify(r));
  }
}

main().catch((err) => {
  console.error('[e2e] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WrenCli } from './cli';

const isWindows = process.platform === 'win32';

const FAKE_WREN = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'context' && args[1] === 'instructions') {
  console.log('# 保险业务规则\\n- 保单状态：02-承保有效');
  process.exit(0);
}
if (args[0] === 'memory' && args[1] === 'fetch') {
  console.log('### Model: ins_policy_main\\n  - policy_no (VARCHAR) — 保单号');
  process.exit(0);
}
if (args[0] === 'dry-run') {
  const sql = args[2] ?? '';
  if (/DROP/i.test(sql)) {
    console.error('Error: [INVALID_SQL] dangerous statement');
    process.exit(1);
  }
  console.log('OK');
  process.exit(0);
}
if (args[0] === '--sql') {
  if (args[1] === 'SELECT 1') {
    console.log(JSON.stringify({ ok: 1 }));
    console.log('\\n# To save this query:');
  }
  process.exit(0);
}
console.error('unhandled: ' + args.join(' '));
process.exit(2);
`;

describe('WrenCli', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function setup(): WrenCli {
    dir = mkdtempSync(join(tmpdir(), 'wren-cli-test-'));
    writeFileSync(join(dir, 'wren_project.yml'), 'schema_version: 5\n');
    // Windows 不支持 shebang 直接执行 .cjs，改用 node 解释器 + .cmd 包装
    const script = join(dir, 'fake-wren.cjs');
    writeFileSync(script, FAKE_WREN);
    let bin: string;
    if (isWindows) {
      bin = join(dir, 'fake-wren.cmd');
      writeFileSync(bin, `@echo off\r\nnode "%~dp0fake-wren.cjs" %*\r\n`);
    } else {
      bin = script;
      chmodSync(bin, 0o755);
    }
    return new WrenCli({ bin, projectDir: dir });
  }

  it('detects availability when the project exists', () => {
    const cli = setup();
    expect(cli.available()).toBe(true);
  });

  it('returns business instructions', async () => {
    const cli = setup();
    expect(await cli.fetchInstructions()).toContain('保单状态：02-承保有效');
  });

  it('returns semantic context for a question', async () => {
    const cli = setup();
    expect(await cli.fetchContext('赔付率')).toContain('ins_policy_main');
  });

  it('accepts a valid SQL in dry-run', async () => {
    const cli = setup();
    const result = await cli.dryRun('SELECT COUNT(*) FROM ins_policy_main');
    expect(result.ok).toBe(true);
  });

  it('rejects a dangerous SQL in dry-run', async () => {
    const cli = setup();
    const result = await cli.dryRun('DROP TABLE ins_policy_main');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('dangerous');
  });

  it('parses NDJSON rows from execute, skipping comments', async () => {
    const cli = setup();
    const rows = await cli.execute('SELECT 1');
    expect(rows).toEqual([{ ok: 1 }]);
  });
});

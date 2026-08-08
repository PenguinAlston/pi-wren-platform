import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WrenCliConfig {
  /** wren 可执行文件（默认 'wren'，可传绝对路径覆盖）。 */
  bin?: string;
  /** Wren 项目目录（wren_project.yml 所在目录）。 */
  projectDir: string;
  /** 单次调用超时（ms，默认 60_000）。 */
  timeoutMs?: number;
}

export interface DryRunResult {
  ok: boolean;
  error?: string;
}

/**
 * 新版 Wren CLI（wrenai）适配器。
 *
 * 新版 Wren（2026-05 起，Rust wren-core + Python CLI）不再提供旧版
 * `/v1/generate_sql` HTTP 接口，而是作为"语义上下文 + 受治理执行"层：
 *   - `wren memory fetch -q <问题>`   检索相关 schema / 相似查询 / 业务规则
 *   - `wren context instructions`     业务规则全文（会话开始时注入）
 *   - `wren dry-run --sql`            校验 SQL（可解析 + 合法 + 仅 MDL 内表）
 *   - `wren --sql ... --output json`  受治理执行（NDJSON）
 *
 * 所有调用都走 execFile 数组参数（不经 shell），避免注入。
 */
export class WrenCli {
  private readonly bin: string;
  private readonly projectDir: string;
  private readonly timeoutMs: number;

  constructor(config: WrenCliConfig) {
    this.bin = config.bin ?? 'wren';
    this.projectDir = config.projectDir;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  /** wren 可执行 + 项目目录是否就绪。 */
  available(): boolean {
    return existsSync(join(this.projectDir, 'wren_project.yml'));
  }

  /** `wren context instructions` —— 业务规则全文。失败时返回空串（不阻断流水线）。 */
  async fetchInstructions(): Promise<string> {
    try {
      const { stdout } = await this.run(['context', 'instructions']);
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * `wren memory fetch -q <问题>` —— 检索与该问题相关的语义上下文
   * （模型/列/相似查询/业务规则）。失败时降级为 instructions 全文。
   */
  async fetchContext(question: string): Promise<string> {
    try {
      const { stdout } = await this.run(['memory', 'fetch', '-q', question]);
      const text = stdout.trim();
      return text || (await this.fetchInstructions());
    } catch {
      return this.fetchInstructions();
    }
  }

  /** `wren dry-run --sql` —— 校验 SQL（解析 + 合法 + 仅 MDL 内表）。 */
  async dryRun(sql: string): Promise<DryRunResult> {
    try {
      await this.run(['dry-run', '--sql', sql]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** `wren --sql ... --output json` —— 受治理执行，返回行对象数组（NDJSON）。 */
  async execute(sql: string): Promise<Record<string, unknown>[]> {
    const { stdout } = await this.run(['--sql', sql, '--output', 'json']);
    const rows: Record<string, unknown>[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    }
    return rows;
  }

  private run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(this.bin, args, {
      cwd: this.projectDir,
      timeout: this.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      killSignal: 'SIGKILL',
    });
  }
}

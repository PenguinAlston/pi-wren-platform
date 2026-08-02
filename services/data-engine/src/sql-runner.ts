import type { QueryResult } from '@pi-wren/shared-types';
import type { Pool } from 'pg';
import { createPool } from './postgres-client';

/** Abstraction so callers can swap Postgres for fakes in tests. */
export interface SqlExecutor {
  /** 参数化查询：params 按 $1/$2 顺序绑定（如未提供则执行裸 SQL）。 */
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export class PostgresSqlExecutor implements SqlExecutor {
  constructor(
    private readonly pool: Pool,
    /** 返回行数上限，防止无 LIMIT 查询把海量结果灌入内存/上下文。 */
    private readonly maxRows = 1_000,
  ) {}

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const result =
        params && params.length > 0 ? await this.pool.query(sql, params) : await this.pool.query(sql);
      return {
        rows: (result.rows as Record<string, unknown>[]).slice(0, this.maxRows),
        count: result.rowCount,
      };
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : String(error);
      throw new Error(`database query failed: ${detail}`, { cause: error });
    }
  }
}

/** 平台默认查询执行器：只读事务 + 30s 语句超时（内置 Agent 与注册表写入共用不同池）。 */
export function createDefaultSqlExecutor(): SqlExecutor {
  return new PostgresSqlExecutor(
    createPool({ readOnly: true, statementTimeoutMillis: 30_000 }),
  );
}

import type { QueryResult } from '@pi-wren/shared-types';
import type { Pool } from 'pg';
import { createPool } from './postgres-client';

/** Abstraction so callers can swap Postgres for fakes in tests. */
export interface SqlExecutor {
  query(sql: string): Promise<QueryResult>;
}

export class PostgresSqlExecutor implements SqlExecutor {
  constructor(private readonly pool: Pool) {}

  async query(sql: string): Promise<QueryResult> {
    try {
      const result = await this.pool.query(sql);
      return {
        rows: result.rows as Record<string, unknown>[],
        count: result.rowCount,
      };
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : String(error);
      throw new Error(`database query failed: ${detail}`, { cause: error });
    }
  }
}

export function createDefaultSqlExecutor(): SqlExecutor {
  return new PostgresSqlExecutor(createPool());
}

import type { QueryResult } from '@pi-wren/shared-types';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { AgentTool } from './registry';

/** Executes a generated SQL statement against the data engine. */
export function createDatabaseTool(sqlExecutor: SqlExecutor): AgentTool<string, QueryResult> {
  return {
    name: 'database_query',
    description: 'Execute a read-only SQL query against the enterprise database',
    async execute(sql) {
      return sqlExecutor.query(sql);
    },
  };
}

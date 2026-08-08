import type { QueryResult } from '@pi-wren/shared-types';
import type { SqlExecutor } from '@pi-wren/data-engine';
import { parseAndValidateSql } from '../context/sql-validation';
import type { AgentTool } from './registry';

/**
 * 执行生成的 SQL 语句。所有来源的 SQL（LLM/WrenAI）
 * 都汇聚到该工具执行，因此在此处做统一的安全校验（唯一执行关口）。
 */
export function createDatabaseTool(
  sqlExecutor: SqlExecutor,
  allowedTables?: string[],
): AgentTool<string, QueryResult> {
  return {
    name: 'database_query',
    description: 'Execute a read-only SQL query against the enterprise database',
    async execute(sql) {
      const validated = parseAndValidateSql(sql, allowedTables);
      return sqlExecutor.query(validated);
    },
  };
}

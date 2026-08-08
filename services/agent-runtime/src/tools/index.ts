import type { ContextEngine } from '@pi-wren/context-engine';
import type { SqlExecutor } from '@pi-wren/data-engine';
import { ToolRegistry } from './registry';
import { createWrenSqlTool } from './wren-sql-tool';
import { createDatabaseTool } from './database-tool';
import { createWrenKnowledgeTool } from './wren-knowledge-tool';

export * from './registry';
export * from './result-analysis-tool';
export * from './database-tool';
export * from './wren-sql-tool';
export * from './wren-knowledge-tool';

/**
 * Build the generic data-analysis tool set (semantic SQL + database + knowledge) with injected dependencies.
 * allowedTables 供 database_query 工具做统一安全校验（表名白名单来自 WrenAI 工程）。
 */
export function createDataAnalysisTools(
  context: ContextEngine,
  sqlExecutor: SqlExecutor,
  allowedTables?: string[],
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createWrenSqlTool(context));
  registry.register(createDatabaseTool(sqlExecutor, allowedTables));
  registry.register(createWrenKnowledgeTool(context));
  return registry;
}

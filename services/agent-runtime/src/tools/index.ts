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

/** Build the default finance analysis tool set with injected dependencies. */
export function createFinanceTools(context: ContextEngine, sqlExecutor: SqlExecutor): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createWrenSqlTool(context));
  registry.register(createDatabaseTool(sqlExecutor));
  registry.register(createWrenKnowledgeTool(context));
  return registry;
}

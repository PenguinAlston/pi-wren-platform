import type { ContextEngine, SemanticConfig } from '@pi-wren/context-engine';
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
 * semanticConfig 供 database_query 工具做统一安全校验（表名白名单来自 MDL）。
 */
export function createDataAnalysisTools(
  context: ContextEngine,
  sqlExecutor: SqlExecutor,
  semanticConfig?: SemanticConfig,
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createWrenSqlTool(context));
  registry.register(createDatabaseTool(sqlExecutor, semanticConfig));
  registry.register(createWrenKnowledgeTool(context));
  return registry;
}

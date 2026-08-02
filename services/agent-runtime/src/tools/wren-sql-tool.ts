import type { ContextEngine } from '@pi-wren/context-engine';
import type { AgentTool } from './registry';

export interface WrenSqlToolOutput {
  sql: string;
}

/** Turns a business question into SQL using the semantic context engine. */
export function createWrenSqlTool(context: ContextEngine): AgentTool<string, WrenSqlToolOutput> {
  return {
    name: 'wren_generate_sql',
    description: 'Generate SQL for a business question using enterprise semantic context',
    async execute(question, toolContext) {
      const sql = await context.generateSQL(question, toolContext.history);
      return { sql };
    },
  };
}

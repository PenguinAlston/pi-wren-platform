import type { ContextEngine } from '@pi-wren/context-engine';
import type { AgentTool } from './registry';

export interface WrenKnowledgeToolOutput {
  results: string[];
}

/** Retrieves enterprise business knowledge relevant to a query. */
export function createWrenKnowledgeTool(
  context: ContextEngine,
): AgentTool<string, WrenKnowledgeToolOutput> {
  return {
    name: 'wren_search_knowledge',
    description: 'Search enterprise business knowledge and metric definitions',
    async execute(query) {
      const results = await context.searchKnowledge(query);
      return { results };
    },
  };
}

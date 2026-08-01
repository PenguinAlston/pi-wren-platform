import { WrenContextEngine } from './context';

export function createWrenTools() {
  const context = new WrenContextEngine();

  return [
    {
      name: 'wren_search_knowledge',
      description: 'Search enterprise business knowledge',
      async execute(input: unknown) {
        return context.searchKnowledge(String(input));
      },
    },
    {
      name: 'wren_generate_sql',
      description: 'Generate SQL using semantic context',
      async execute(input: unknown) {
        return context.generateSQL(String(input));
      },
    },
  ];
}

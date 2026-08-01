export interface ContextEngine {
  searchKnowledge(query: string): Promise<string[]>;
  getMetric(name: string): Promise<unknown>;
  generateSQL(question: string): Promise<string>;
}

export class WrenContextEngine implements ContextEngine {
  async searchKnowledge(query: string): Promise<string[]> {
    return [`Knowledge result for: ${query}`];
  }

  async getMetric(name: string): Promise<unknown> {
    return {
      name,
      definition: 'Metric definition placeholder',
    };
  }

  async generateSQL(question: string): Promise<string> {
    return `-- Generated SQL for: ${question}`;
  }
}

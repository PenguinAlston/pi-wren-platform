import type { MetricDefinition } from '@pi-wren/shared-types';
import { generateDemoSQL } from './demo-sql-generator';
import { getMetric, listMetrics } from './metrics';
import type { GenerateSQLResult } from './wren/client';
import { WrenAIClient } from './wren/client';

export interface ContextEngine {
  /** Turn a natural-language question into SQL. */
  generateSQL(question: string): Promise<string>;
  /** Retrieve enterprise business knowledge snippets. */
  searchKnowledge(query: string): Promise<string[]>;
  /** Look up a business metric definition. */
  getMetric(name: string): Promise<MetricDefinition | undefined>;
  /** List all known business metrics. */
  listMetrics(): Promise<MetricDefinition[]>;
}

/** Local demo engine: deterministic SQL generation + canned knowledge. */
export class DemoContextEngine implements ContextEngine {
  async generateSQL(question: string): Promise<string> {
    return generateDemoSQL(question);
  }

  async searchKnowledge(query: string): Promise<string[]> {
    return [
      `Finance facts are stored per quarter in the finance_fact table.`,
      `Relevant metric for "${query}": see profit/revenue/cost definitions.`,
    ];
  }

  async getMetric(name: string): Promise<MetricDefinition | undefined> {
    return getMetric(name);
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return listMetrics();
  }
}

/** Production engine backed by a real Wren AI service. */
export class WrenContextEngine implements ContextEngine {
  private readonly client: WrenAIClient;

  constructor(config: { endpoint: string; token?: string }) {
    this.client = new WrenAIClient(config);
  }

  async generateSQL(question: string): Promise<string> {
    const result: GenerateSQLResult = await this.client.generateSQL(question);
    if (!result.sql) {
      throw new Error(result.error ?? 'Wren AI returned no SQL');
    }
    return result.sql;
  }

  async searchKnowledge(_query: string): Promise<string[]> {
    return [];
  }

  async getMetric(name: string): Promise<MetricDefinition | undefined> {
    return getMetric(name);
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return listMetrics();
  }
}

import type { MetricDefinition } from '@pi-wren/shared-types';
import { generateDemoSQL } from './demo-sql-generator';
import { getMetric, listMetrics } from './metrics';
import type { GenerateSQLResult } from './wren/client';
import { WrenAIClient } from './wren/client';

/** 多轮会话上下文中的一轮对话（用于 SQL 生成的指代消解，需求 4.3.3）。 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ContextEngine {
  /** Turn a natural-language question into SQL（history 为最近几轮对话，用于多轮延续解析）。 */
  generateSQL(question: string, history?: ConversationTurn[]): Promise<string>;
  /** Retrieve enterprise business knowledge snippets. */
  searchKnowledge(query: string): Promise<string[]>;
  /** Look up a business metric definition. */
  getMetric(name: string): Promise<MetricDefinition | undefined>;
  /** List all known business metrics. */
  listMetrics(): Promise<MetricDefinition[]>;
}

/** Local demo engine: deterministic SQL generation + canned knowledge. */
export class DemoContextEngine implements ContextEngine {
  async generateSQL(question: string, _history?: ConversationTurn[]): Promise<string> {
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

  async generateSQL(question: string, _history?: ConversationTurn[]): Promise<string> {
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

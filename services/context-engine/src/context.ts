import type { MetricDefinition } from '@pi-wren/shared-types';

/** 多轮会话上下文中的一轮对话（用于 SQL 生成的指代消解，需求 4.3.3）。 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 语义层引擎契约：把自然语言问题转成 SQL，并提供业务知识/指标检索。
 * 实现见 agent-runtime 的 WrenCliContextEngine（基于 WrenAI CLI 的受治理语义层）。
 */
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

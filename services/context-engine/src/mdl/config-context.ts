import type { MetricDefinition } from '@pi-wren/shared-types';
import type { ContextEngine } from '../context';
import type { SemanticConfig, SemanticIntent } from './types';

/**
 * 配置驱动的语义引擎：完全由 YAML 语义配置决定行为。
 * 思路与 Wren AI 的 MDL 对齐：模型 + 指标 + 知识 + 意图(SQL 生成规则)。
 */
export class ConfigDrivenContextEngine implements ContextEngine {
  constructor(private readonly config: SemanticConfig) {}

  async generateSQL(question: string): Promise<string> {
    const intent = this.matchIntent(question);
    if (!intent) {
      throw new Error(`无法为该问题生成 SQL：${question}`);
    }
    return intent.sql;
  }

  async searchKnowledge(query: string): Promise<string[]> {
    const q = query.toLowerCase();
    const words = q.split(/[\s,，。、?？]+/).filter((w) => w.length > 1);
    return this.config.knowledge.filter((item) => {
      const lower = item.toLowerCase();
      return words.some((word) => lower.includes(word)) || (q.length > 0 && lower.includes(q));
    });
  }

  async getMetric(name: string): Promise<MetricDefinition | undefined> {
    const metric = this.config.metrics.find((m) => m.name === name);
    return metric ? { name: metric.name, definition: metric.definition, unit: metric.unit } : undefined;
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return this.config.metrics.map((m) => ({
      name: m.name,
      definition: m.definition,
      unit: m.unit,
    }));
  }

  private matchIntent(question: string): SemanticIntent | undefined {
    const q = question.toLowerCase();
    // 关键词评分：命中关键词最多的意图胜出，减少短词误匹配
    let best: SemanticIntent | undefined;
    let bestScore = 0;
    for (const intent of this.config.intents) {
      const score = intent.keywords.reduce(
        (acc, keyword) => (q.includes(keyword.toLowerCase()) ? acc + 1 : acc),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        best = intent;
      }
    }
    if (best && bestScore > 0) {
      return best;
    }
    if (this.config.defaultIntent) {
      return this.config.intents.find((i) => i.name === this.config.defaultIntent);
    }
    return this.config.intents.find((i) => i.name === 'default');
  }
}

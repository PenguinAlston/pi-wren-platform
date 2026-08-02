import type { MetricDefinition } from '@pi-wren/shared-types';
import type { ContextEngine, ConversationTurn } from '../context';
import { extractQuestionElements } from './question-elements';
import type { SemanticConfig, SemanticIntent } from './types';

/**
 * 配置驱动的语义引擎：完全由 YAML 语义配置决定行为。
 * 思路与 Wren AI 的 MDL 对齐：模型 + 指标 + 知识 + 意图(SQL 生成规则)。
 */
export class ConfigDrivenContextEngine implements ContextEngine {
  constructor(private readonly config: SemanticConfig) {}

  async generateSQL(question: string, history?: ConversationTurn[]): Promise<string> {
    const intent = this.resolveIntent(question, history);
    if (!intent) {
      throw new Error(`无法为该问题生成 SQL：${question}`);
    }
    return renderIntentSql(intent, question);
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
    return metric
      ? { name: metric.name, definition: metric.definition, unit: metric.unit }
      : undefined;
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return this.config.metrics.map((m) => ({
      name: m.name,
      definition: m.definition,
      unit: m.unit,
    }));
  }

  /** 意图解析：当前问题关键词命中优先；无命中时沿用上一轮意图（省略式追问），最后兜底默认意图。 */
  private resolveIntent(question: string, history?: ConversationTurn[]): SemanticIntent | undefined {
    const direct = this.matchIntent(question);
    if (direct) {
      return direct;
    }
    const fromHistory = this.matchHistoryIntent(history);
    if (fromHistory) {
      return fromHistory;
    }
    if (this.config.defaultIntent) {
      return this.config.intents.find((i) => i.name === this.config.defaultIntent);
    }
    return this.config.intents.find((i) => i.name === 'default');
  }

  private matchIntent(question: string): SemanticIntent | undefined {
    const q = question.toLowerCase();
    const elements = extractQuestionElements(question);
    // 关键词评分 + 问题要素（明细/聚合/年份/口径）加权，避免短词误匹配与"答非所问"
    let best: SemanticIntent | undefined;
    let bestScore = 0;
    for (const intent of this.config.intents) {
      let score = intent.keywords.reduce(
        (acc, keyword) => (q.includes(keyword.toLowerCase()) ? acc + 1 : acc),
        0,
      );

      const kind = intent.kind ?? 'aggregate';
      if (kind === 'detail') {
        // 用户要明细时偏好明细意图；只要汇总时打压明细意图
        if (elements.wantsDetail) {
          score += 2;
        }
        if (elements.wantsAggregate) {
          score -= 2;
        }
      } else {
        if (elements.wantsAggregate) {
          score += 2;
        }
        if (elements.wantsDetail) {
          score -= 1;
        }
      }

      // 年份参数：问题带年份时给支持 year 占位符的意图加分
      if (intent.params?.includes('year') && elements.hasYear) {
        score += 1;
      }

      // "终止/到期"口径歧义消解（纯关键词驱动，避免硬编码意图名）：
      // - 只出现"到期/满期"→ 日期口径意图自然胜出（关键词差异）
      // - 只出现"终止"且带年份 → 需要同时看到两种口径的明细（含状态列），到期明细意图兜底
      // - 明确"已终止"→ 状态口径意图关键词更具体，命中更多
      if (score > bestScore) {
        bestScore = score;
        best = intent;
      }
    }
    return best && bestScore > 0 ? best : undefined;
  }

  /** 从最近几轮对话中寻找上一轮的命中意图（多轮省略式追问，如"那理赔呢？"）。 */
  private matchHistoryIntent(history?: ConversationTurn[]): SemanticIntent | undefined {
    if (!history) {
      return undefined;
    }
    for (const turn of [...history].reverse()) {
      if (turn.role === 'user') {
        const intent = this.matchIntent(turn.content);
        if (intent) {
          return intent;
        }
      }
    }
    return undefined;
  }
}

/**
 * 渲染意图 SQL 模板：把 {year} 替换为年份谓词。
 * - 问题含年份 → 生成 BETWEEN '2025-01-01' AND '2025-12-31'
 * - 问题无年份 → 使用意图声明的 yearFallback（缺省 1=1，即不过滤）
 */
export function renderIntentSql(intent: SemanticIntent, question: string): string {
  if (!intent.sql.includes('{year}')) {
    return intent.sql;
  }
  const { years } = extractQuestionElements(question);
  const year = years[0];
  const yearPredicate = year
    ? `p.end_date BETWEEN '${year}-01-01' AND '${year}-12-31'`
    : (intent.yearFallback ?? '1=1');
  return intent.sql.replaceAll('{year}', yearPredicate);
}

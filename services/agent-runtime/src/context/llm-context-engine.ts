import type { ChatMessage, MetricDefinition } from '@pi-wren/shared-types';
import type { ModelProvider } from '@pi-wren/agent-sdk';
import type { ContextEngine, ConversationTurn, SemanticConfig } from '@pi-wren/context-engine';
import { extractQuestionElements } from '@pi-wren/context-engine';
import { parseAndValidateSql } from './sql-validation';

export interface LlmContextEngineOptions {
  model: ModelProvider;
  config: SemanticConfig;
  /** 确定性降级引擎（规则匹配），LLM 失败/校验失败时兜底 */
  fallback: ContextEngine;
  maxSqlLength?: number;
}

const SYSTEM_PROMPT =
  'You are a senior BI engineer writing PostgreSQL for an enterprise business data platform. ' +
  'Return ONLY a single read-only SQL statement (SELECT or WITH). ' +
  'No explanations, no markdown. Never modify data. ' +
  'Use the declared tables/columns; join sys_dict when you need Chinese dictionary labels. ' +
  'When the user asks for detail fields such as policy number, customer name, or specific dates, ' +
  'you MUST SELECT those columns and JOIN the needed tables (e.g. ins_customer.customer_name via ' +
  'insured_id) instead of returning only aggregate statistics. ' +
  'Prefer aggregations consistent with the provided business knowledge and examples. ' +
  'When the user question continues the previous turn (mentions 那/也/分别/再/按…划分/继续 or ' +
  'omits the dimension), KEEP the previous turn\'s analysis dimension (e.g. channel, product type, ' +
  'status) instead of switching to a different one. Never invent data from history: the answer must ' +
  'be derived from the current query result only.';

/** 提示词中最多展示的"问题→SQL"示例数。 */
const MAX_EXAMPLES = 6;

function buildSqlPrompt(question: string, config: SemanticConfig): string {
  const lines: string[] = [];

  lines.push('Tables:');
  for (const model of config.models) {
    const columns =
      (model.columns ?? [])
        .map((c) => `${c.name}(${c.type}${c.label ? ` ${c.label}` : ''})`)
        .join(', ') || '(no columns declared)';
    lines.push(`- ${model.table}: ${columns}${model.description ? ` — ${model.description}` : ''}`);
  }

  if (config.knowledge.length > 0) {
    lines.push('');
    lines.push('Business knowledge:');
    lines.push(...config.knowledge.map((k) => `- ${k}`));
  }

  // 示例排序：明细类问题优先展示 detail 意图示例，统计类问题优先展示聚合示例
  const elements = extractQuestionElements(question);
  const examples = [...config.intents].sort((a, b) => {
    const aDetail = a.kind === 'detail' ? 1 : 0;
    const bDetail = b.kind === 'detail' ? 1 : 0;
    return elements.wantsDetail ? bDetail - aDetail : aDetail - bDetail;
  });
  const selected = examples.slice(0, MAX_EXAMPLES);
  if (selected.length > 0) {
    lines.push('');
    lines.push('Examples of question -> SQL:');
    for (const example of selected) {
      lines.push(`Q: ${example.keywords[0] ?? example.name}`);
      lines.push(`SQL: ${example.sql.replace(/\s+/g, ' ').trim()}`);
    }
  }

  lines.push('');
  lines.push('Question:');
  lines.push(question);
  return lines.join('\n');
}

/** 注入提示词的最近对话轮数上限（user+assistant 成对）。 */
const HISTORY_INJECTION_TURNS = 3;

/** 把最近几轮对话格式化为提示词片段（只用于指代消解，禁止据此编造数据）。 */
function buildHistoryBlock(history: ConversationTurn[]): string {
  const lines = [
    'Recent conversation of this session (context only, never invent data from it):',
  ];
  const turns = history.slice(-HISTORY_INJECTION_TURNS * 2);
  for (const turn of turns) {
    const content = turn.content.length > 300 ? `${turn.content.slice(0, 300)}…` : turn.content;
    lines.push(`${turn.role === 'user' ? 'User' : 'Assistant'}: ${content}`);
  }
  return lines.join('\n');
}

/**
 * LLM 语义引擎：用大模型为任意自然语言问题动态生成 SQL。
 * 失败或校验不通过时自动降级到确定性规则引擎，保证查询可用性。
 */
export class LlmContextEngine implements ContextEngine {
  constructor(private readonly opts: LlmContextEngineOptions) {}

  async generateSQL(question: string, history?: ConversationTurn[]): Promise<string> {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(history && history.length > 0
          ? [{ role: 'user' as const, content: buildHistoryBlock(history) }]
          : []),
        { role: 'user', content: buildSqlPrompt(question, this.opts.config) },
      ];
      const response = await this.opts.model.chat(messages, {
        temperature: 0,
        maxTokens: 800,
        signal: AbortSignal.timeout(100_000),
      });
      return parseAndValidateSql(response.content, this.opts.config, this.opts.maxSqlLength);
    } catch {
      // LLM 不可用或输出不安全 → 降级到确定性语义引擎
      return this.opts.fallback.generateSQL(question);
    }
  }

  async searchKnowledge(query: string): Promise<string[]> {
    return this.opts.fallback.searchKnowledge(query);
  }

  async getMetric(name: string): Promise<MetricDefinition | undefined> {
    return this.opts.fallback.getMetric(name);
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return this.opts.fallback.listMetrics();
  }
}

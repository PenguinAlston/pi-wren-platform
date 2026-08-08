import type { ModelProvider } from '@pi-wren/agent-sdk';
import type { ChatMessage, MetricDefinition } from '@pi-wren/shared-types';
import type { ContextEngine, ConversationTurn, WrenCli } from '@pi-wren/context-engine';
import { SYSTEM_PROMPT, buildHistoryBlock } from './prompt';
import { extractSql } from './sql-validation';

export interface WrenCliContextEngineOptions {
  model: ModelProvider;
  cli: WrenCli;
}

function buildWrenPrompt(question: string, context: string, instructions: string): string {
  const lines: string[] = [];
  if (instructions) {
    lines.push('Business rules:');
    lines.push(instructions);
    lines.push('');
  }
  if (context) {
    lines.push('Semantic schema and similar queries for this question:');
    lines.push(context);
    lines.push('');
  }
  lines.push('Question:');
  lines.push(question);
  return lines.join('\n');
}

/**
 * WrenAI CLI 语义引擎（完全拥抱 WrenAI 后的唯一语义层实现）：
 * 用 `wren memory fetch` + `wren context instructions` 注入受治理语义上下文，
 * 由 LLM 生成 SQL，再经 `wren dry-run` 做受治理校验后返回。
 * LLM 不可用或 dry-run 不通过时抛错（不再有确定性兜底）。
 */
export class WrenCliContextEngine implements ContextEngine {
  constructor(private readonly opts: WrenCliContextEngineOptions) {}

  async generateSQL(question: string, history?: ConversationTurn[]): Promise<string> {
    const [context, instructions] = await Promise.all([
      this.opts.cli.fetchContext(question),
      this.opts.cli.fetchInstructions(),
    ]);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(history && history.length > 0
        ? [{ role: 'user' as const, content: buildHistoryBlock(history) }]
        : []),
      { role: 'user', content: buildWrenPrompt(question, context, instructions) },
    ];
    const response = await this.opts.model.chat(messages, {
      temperature: 0,
      maxTokens: 800,
      signal: AbortSignal.timeout(100_000),
    });
    // 剥离 markdown 代码块（LLM 常返回 ```sql ... ```），避免 wren dry-run 解析失败
    const sql = extractSql(response.content);
    if (!sql) {
      throw new Error('LLM 返回了空 SQL');
    }
    const dry = await this.opts.cli.dryRun(sql);
    if (!dry.ok) {
      throw new Error(`wren dry-run rejected sql: ${dry.error ?? 'unknown'}`);
    }
    return sql;
  }

  async searchKnowledge(query: string): Promise<string[]> {
    const context = await this.opts.cli.fetchContext(query);
    return context ? [context] : [];
  }

  async getMetric(_name: string): Promise<MetricDefinition | undefined> {
    // 指标定义已融入 wren 的业务规则上下文，无独立结构化查询
    return undefined;
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return [];
  }
}

import type { ModelProvider } from '@pi-wren/agent-sdk';
import type { ChatMessage, MetricDefinition } from '@pi-wren/shared-types';
import type { ContextEngine, ConversationTurn, SemanticConfig } from '@pi-wren/context-engine';
import type { WrenCli } from '@pi-wren/context-engine';
import { buildHistoryBlock, SYSTEM_PROMPT } from './llm-context-engine';
import { parseAndValidateSql } from './sql-validation';

export interface WrenCliContextEngineOptions {
  model: ModelProvider;
  cli: WrenCli;
  /** 本地语义配置（用于白名单校验，可选；不提供时只依赖 wren dry-run 受治理校验）。 */
  config?: SemanticConfig;
  /** 确定性降级引擎（LLM 失败 / 校验失败时兜底）。 */
  fallback: ContextEngine;
  maxSqlLength?: number;
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
 * 新版 Wren CLI（wrenai）语义引擎：
 * 用 `wren memory fetch` + `wren context instructions` 注入受治理语义上下文，
 * 由 LLM 生成 SQL，再经 `wren dry-run` 做受治理校验后返回。
 * 任何一步失败都降级到确定性规则引擎，保证查询可用性。
 */
export class WrenCliContextEngine implements ContextEngine {
  constructor(private readonly opts: WrenCliContextEngineOptions) {}

  async generateSQL(question: string, history?: ConversationTurn[]): Promise<string> {
    try {
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
      const sql = this.opts.config
        ? parseAndValidateSql(response.content, this.opts.config, this.opts.maxSqlLength)
        : response.content.trim();
      const dry = await this.opts.cli.dryRun(sql);
      if (!dry.ok) {
        throw new Error(`wren dry-run rejected sql: ${dry.error ?? 'unknown'}`);
      }
      return sql;
    } catch {
      // LLM 不可用、本地校验失败或 wren 受治理校验不通过 → 降级到确定性语义引擎
      return this.opts.fallback.generateSQL(question, history);
    }
  }

  async searchKnowledge(query: string): Promise<string[]> {
    const context = await this.opts.cli.fetchContext(query);
    if (context) return [context];
    return this.opts.fallback.searchKnowledge(query);
  }

  async getMetric(name: string): Promise<MetricDefinition | undefined> {
    return this.opts.fallback.getMetric(name);
  }

  async listMetrics(): Promise<MetricDefinition[]> {
    return this.opts.fallback.listMetrics();
  }
}

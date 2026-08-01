import {
  createModelProvider,
  type ModelProvider,
  type ProviderKind,
} from '@pi-wren/agent-sdk';
import { FinanceAgent, createFinanceTools, InMemoryMemoryStore } from '@pi-wren/agent-runtime';
import { DemoContextEngine, WrenContextEngine, type ContextEngine } from '@pi-wren/context-engine';
import { createDefaultSqlExecutor } from '@pi-wren/data-engine';
import type { MetricDefinition } from '@pi-wren/shared-types';
import type { ApiConfig } from './config';
import type { Logger } from './logger';

export interface ApiDeps {
  config: ApiConfig;
  logger: Logger;
  agent: FinanceAgent;
  metrics: MetricDefinition[];
}

function buildModel(config: ApiConfig): ModelProvider {
  return createModelProvider({
    kind: config.LLM_PROVIDER as ProviderKind,
    apiKey: config.OPENAI_API_KEY ?? config.ANTHROPIC_API_KEY,
    baseUrl: config.OPENAI_BASE_URL ?? config.OLLAMA_BASE_URL,
    model: config.OPENAI_MODEL ?? config.ANTHROPIC_MODEL ?? config.OLLAMA_MODEL,
  });
}

function buildContext(config: ApiConfig): ContextEngine {
  if (config.WREN_URL) {
    return new WrenContextEngine({ endpoint: config.WREN_URL, token: config.WREN_TOKEN });
  }
  return new DemoContextEngine();
}

/** Wire together the application dependencies from validated config. */
export async function buildDeps(config: ApiConfig, logger: Logger): Promise<ApiDeps> {
  const context = buildContext(config);
  const sql = createDefaultSqlExecutor();
  const tools = createFinanceTools(context, sql);
  const memory = new InMemoryMemoryStore();
  // mock 提供器仅用于离线演示，此时不注入 LLM，使用确定性的业务分析摘要作为回答
  const model = config.LLM_PROVIDER === 'mock' ? undefined : buildModel(config);
  const agent = new FinanceAgent({ context, sql, tools, model, memory });

  logger.info({ provider: model?.name ?? 'none', wren: Boolean(config.WREN_URL) }, 'dependencies initialized');

  return {
    config,
    logger,
    agent,
    metrics: await context.listMetrics(),
  };
}

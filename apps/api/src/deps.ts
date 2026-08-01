import {
  createModelProvider,
  type ModelProvider,
  type ProviderKind,
} from '@pi-wren/agent-sdk';
import {
  DataAnalysisAgent,
  LlmContextEngine,
  createFinanceTools,
  InMemoryMemoryStore,
  financeDomain,
  insuranceDomain,
  type AgentDomainConfig,
  type MemoryStore,
} from '@pi-wren/agent-runtime';
import {
  ConfigDrivenContextEngine,
  WrenContextEngine,
  loadSemanticConfig,
  resolveSemanticFile,
  type ContextEngine,
} from '@pi-wren/context-engine';
import { createDefaultSqlExecutor, type SqlExecutor } from '@pi-wren/data-engine';
import type { MetricDefinition } from '@pi-wren/shared-types';
import { join } from 'node:path';
import type { ApiConfig } from './config';
import type { Logger } from './logger';

export interface AgentSpec {
  id: string;
  label: string;
  description: string;
  agent: DataAnalysisAgent;
  metrics: MetricDefinition[];
}

export interface ApiDeps {
  config: ApiConfig;
  logger: Logger;
  agents: AgentSpec[];
}

interface DomainRegistration {
  domain: AgentDomainConfig;
  semanticFile: string;
}

const DOMAINS: DomainRegistration[] = [
  { domain: financeDomain, semanticFile: 'finance.mdl.yml' },
  { domain: insuranceDomain, semanticFile: 'insurance.mdl.yml' },
];

function buildModel(config: ApiConfig): ModelProvider | undefined {
  if (config.LLM_PROVIDER === 'mock') {
    // mock 提供器仅用于离线演示，此时不注入 LLM，使用确定性的业务分析摘要作为回答
    return undefined;
  }
  return createModelProvider({
    kind: config.LLM_PROVIDER as ProviderKind,
    apiKey: config.OPENAI_API_KEY ?? config.ANTHROPIC_API_KEY,
    baseUrl: config.OPENAI_BASE_URL ?? config.OLLAMA_BASE_URL,
    model: config.OPENAI_MODEL ?? config.ANTHROPIC_MODEL ?? config.OLLAMA_MODEL,
  });
}

function buildContext(
  config: ApiConfig,
  semanticFile: string,
  model?: ModelProvider,
): ContextEngine {
  if (config.WREN_URL) {
    return new WrenContextEngine({ endpoint: config.WREN_URL, token: config.WREN_TOKEN });
  }
  const path = config.SEMANTIC_DIR
    ? join(config.SEMANTIC_DIR, semanticFile)
    : resolveSemanticFile(semanticFile);
  const semanticConfig = loadSemanticConfig(path);
  const configEngine = new ConfigDrivenContextEngine(semanticConfig);
  // 配置了真实 LLM 时启用动态 SQL 生成，规则引擎作为降级兜底
  return model
    ? new LlmContextEngine({ model, config: semanticConfig, fallback: configEngine })
    : configEngine;
}

/** Wire together the application dependencies from validated config. */
export async function buildDeps(config: ApiConfig, logger: Logger): Promise<ApiDeps> {
  const model = buildModel(config);
  const memory: MemoryStore = new InMemoryMemoryStore();
  const agents: AgentSpec[] = [];

  for (const { domain, semanticFile } of DOMAINS) {
    const context = buildContext(config, semanticFile, model);
    const sql: SqlExecutor = createDefaultSqlExecutor();
    const tools = createFinanceTools(context, sql);
    const agent = new DataAnalysisAgent({ domain, context, sql, tools, model, memory });
    agents.push({
      id: domain.id,
      label: domain.label,
      description: domain.description,
      agent,
      metrics: await context.listMetrics(),
    });
  }

  logger.info(
    {
      provider: model?.name ?? 'none',
      wren: Boolean(config.WREN_URL),
      domains: agents.map((a) => a.id),
    },
    'dependencies initialized',
  );

  return { config, logger, agents };
}

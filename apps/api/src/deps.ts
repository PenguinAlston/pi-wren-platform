import {
  createModelProvider,
  type ModelProvider,
  type ProviderKind,
} from '@pi-wren/agent-sdk';
import {
  DataAnalysisAgent,
  LlmContextEngine,
  createDataAnalysisTools,
  financeDomain,
  insuranceDomain,
  type AgentDomainConfig,
  type MemoryStore,
} from '@pi-wren/agent-runtime';
import {
  AgentRegistry,
  NoopAuditLogger,
  PostgresAgentConfigStore,
  PostgresOperationAuditLogger,
  type CustomAgentFactory,
  type OperationAuditLogger,
} from '@pi-wren/agent-registry';
import {
  ConfigDrivenContextEngine,
  WrenContextEngine,
  loadSemanticConfig,
  resolveSemanticFile,
  type ContextEngine,
  type SemanticConfig,
} from '@pi-wren/context-engine';
import { createDefaultSqlExecutor, createPool, type SqlExecutor } from '@pi-wren/data-engine';
import { PiSessionStore } from '@pi-wren/pi-bridge';
import type { MetricDefinition } from '@pi-wren/shared-types';
import { join } from 'node:path';
import type { ApiConfig } from './config';
import { createCustomAgentFactory } from './custom-agent-factory';
import { AgentPoolManager } from './pool-manager';
import type { Logger } from './logger';

export interface AgentSpec {
  id: string;
  label: string;
  description: string;
  agent: DataAnalysisAgent;
  metrics: MetricDefinition[];
  /** builtin=代码内置；custom=用户通过管理 API 注册 */
  source: 'builtin' | 'custom';
}

export interface ApiDeps {
  config: ApiConfig;
  logger: Logger;
  agents: AgentSpec[];
  /** 自定义 Agent 注册表（未配置 AGENT_SECRET_KEY 时为 undefined）。 */
  customAgents?: AgentRegistry<AgentSpec>;
  /** 自定义 Agent 连接池管理器（监控/释放）。 */
  poolManager?: AgentPoolManager;
  /** 操作审计（sys_operation_log）。 */
  audit?: OperationAuditLogger;
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

interface BuiltContext {
  context: ContextEngine;
  /** 本地语义配置（供 database_query 做表名白名单校验）；Wren 路径无。 */
  semanticConfig?: SemanticConfig;
}

function buildContext(
  config: ApiConfig,
  semanticFile: string,
  model?: ModelProvider,
): BuiltContext {
  if (config.WREN_URL) {
    return { context: new WrenContextEngine({ endpoint: config.WREN_URL, token: config.WREN_TOKEN }) };
  }
  const path = config.SEMANTIC_DIR
    ? join(config.SEMANTIC_DIR, semanticFile)
    : resolveSemanticFile(semanticFile);
  const semanticConfig = loadSemanticConfig(path);
  const configEngine = new ConfigDrivenContextEngine(semanticConfig);
  // 配置了真实 LLM 时启用动态 SQL 生成，规则引擎作为降级兜底
  const context = model
    ? new LlmContextEngine({ model, config: semanticConfig, fallback: configEngine })
    : configEngine;
  return { context, semanticConfig };
}

async function buildBuiltinAgents(
  config: ApiConfig,
  model: ModelProvider | undefined,
  memory: MemoryStore,
): Promise<AgentSpec[]> {
  const agents: AgentSpec[] = [];
  for (const { domain, semanticFile } of DOMAINS) {
    const { context, semanticConfig } = buildContext(config, semanticFile, model);
    const sql: SqlExecutor = createDefaultSqlExecutor();
    const tools = createDataAnalysisTools(context, sql, semanticConfig);
    const agent = new DataAnalysisAgent({ domain, context, sql, tools, model, memory });
    agents.push({
      id: domain.id,
      label: domain.label,
      description: domain.description,
      agent,
      metrics: await context.listMetrics(),
      source: 'builtin',
    });
  }
  return agents;
}

/** Wire together the application dependencies from validated config. */
export async function buildDeps(config: ApiConfig, logger: Logger): Promise<ApiDeps> {
  const model = buildModel(config);
  const memory: MemoryStore = new PiSessionStore({
    ...(config.SESSION_DIR ? { sessionsRoot: config.SESSION_DIR } : {}),
  });
  const agents = await buildBuiltinAgents(config, model, memory);
  const deps: ApiDeps = {
    config,
    logger,
    agents,
    audit: new NoopAuditLogger(),
  };

  // 自定义 Agent：配置了 AGENT_SECRET_KEY 时启用（连接串加密存储）
  if (config.AGENT_SECRET_KEY) {
    const poolManager = new AgentPoolManager();
    deps.poolManager = poolManager;
    const factory: CustomAgentFactory<AgentSpec> = createCustomAgentFactory({
      model,
      memory,
      poolManager,
    });
    const registry = new AgentRegistry<AgentSpec>({
      store: new PostgresAgentConfigStore(createPool()),
      factory,
      secretKey: config.AGENT_SECRET_KEY,
      onDispose: (agentId) => poolManager.dispose(agentId),
    });
    const load = await registry.loadAll();
    if (load.failed.length > 0) {
      logger.warn({ failed: load.failed }, 'some custom agents failed to load');
    }
    deps.customAgents = registry;
    agents.push(...registry.list());
  }

  // 管理操作审计（写入 sys_operation_log；失败不阻断）
  deps.audit = new PostgresOperationAuditLogger(createPool(), config.AUDIT_USER_ID);

  logger.info(
    {
      provider: model?.name ?? 'none',
      wren: Boolean(config.WREN_URL),
      domains: agents.map((a) => a.id),
      customAgents: agents.filter((a) => a.source === 'custom').length,
    },
    'dependencies initialized',
  );

  return deps;
}

import {
  createModelProvider,
  type ModelProvider,
  type ProviderKind,
} from '@pi-wren/agent-sdk';
import {
  DataAnalysisAgent,
  WrenCliContextEngine,
  createDataAnalysisTools,
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
  WrenCli,
  allowedTablesOf,
  isWrenProjectReady,
  loadWrenProject,
  type ContextEngine,
} from '@pi-wren/context-engine';
import { InsuranceQueryService } from '@pi-wren/insurance-query';
import { createDefaultSqlExecutor, createPool, type SqlExecutor } from '@pi-wren/data-engine';
import { PiSessionStore } from '@pi-wren/pi-bridge';
import type { MetricDefinition } from '@pi-wren/shared-types';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  /** 传统查询服务（契约/保全/理赔 + 字典，需求第 3 章）。 */
  query?: InsuranceQueryService;
  /** AI 会话仓库（开源 Pi jsonl），支撑左侧会话栏/回看/重命名/删除（需求 4.2）。 */
  sessions?: PiSessionStore;
}

interface DomainRegistration {
  domain: AgentDomainConfig;
}

// 平台当前仅保留保险综合查询 Agent（需求聚焦保险业务；财务等其他领域可按需重新注册）
const DOMAINS: DomainRegistration[] = [{ domain: insuranceDomain }];

function buildModel(config: ApiConfig): ModelProvider | undefined {
  if (config.LLM_PROVIDER === 'mock') {
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
  /** 表名白名单（来自 WrenAI 工程的 table_reference），供 database_query 安全校验。 */
  allowedTables: string[];
}

/** 解析 Wren CLI 项目目录：优先显式配置（相对 cwd 解析为绝对路径），其次仓库 semantic/wren。 */
function resolveWrenProjectDir(config: ApiConfig): string | undefined {
  const cwd = process.cwd();
  const candidates = config.WREN_PROJECT_DIR
    ? [
        resolve(cwd, config.WREN_PROJECT_DIR),
        // 兼容从 apps/api 子目录启动的场景：向上找仓库根
        resolve(cwd, '..', config.WREN_PROJECT_DIR),
        resolve(cwd, '..', '..', config.WREN_PROJECT_DIR),
      ]
    : [
        join(cwd, 'semantic/wren'),
        join(cwd, '..', 'semantic/wren'),
        join(cwd, '..', '..', 'semantic/wren'),
      ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'wren_project.yml'))) return candidate;
  }
  return undefined;
}

/**
 * 构建 WrenAI CLI 语义引擎：完全拥抱 WrenAI 后的唯一语义层路径。
 * 需要 LLM provider + WREN_BIN + 就绪的 WrenAI 工程，任一缺失即抛错（不再有确定性兜底）。
 */
function buildContext(config: ApiConfig, model: ModelProvider, projectDir: string): BuiltContext {
  const cli = new WrenCli({ bin: config.WREN_BIN, projectDir });
  const project = loadWrenProject(projectDir);
  return {
    context: new WrenCliContextEngine({ model, cli }),
    allowedTables: allowedTablesOf(project),
  };
}

async function buildBuiltinAgents(
  config: ApiConfig,
  model: ModelProvider,
  projectDir: string,
  memory: MemoryStore,
): Promise<AgentSpec[]> {
  const agents: AgentSpec[] = [];
  for (const { domain } of DOMAINS) {
    const { context, allowedTables } = buildContext(config, model, projectDir);
    const sql: SqlExecutor = createDefaultSqlExecutor();
    const tools = createDataAnalysisTools(context, sql, allowedTables);
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
  if (!model) {
    throw new Error(
      '完全拥抱 WrenAI 后必须配置真实 LLM provider（LLM_PROVIDER != mock），因为 SQL 生成依赖 LLM。',
    );
  }
  const projectDir = resolveWrenProjectDir(config);
  if (!projectDir || !config.WREN_BIN || !isWrenProjectReady(projectDir)) {
    throw new Error(
      '必须配置 WREN_BIN 且 WrenAI 工程就绪（wren_project.yml 存在）；请参考 README 部署 WrenAI CLI。',
    );
  }

  const memory = new PiSessionStore({
    ...(config.SESSION_DIR ? { sessionsRoot: config.SESSION_DIR } : {}),
  });
  const agents = await buildBuiltinAgents(config, model, projectDir, memory);
  const query = new InsuranceQueryService(createDefaultSqlExecutor());
  const deps: ApiDeps = {
    config,
    logger,
    agents,
    audit: new NoopAuditLogger(),
    query,
    sessions: memory,
  };

  // 自定义 Agent：配置了 AGENT_SECRET_KEY 时启用（连接串加密存储）
  if (config.AGENT_SECRET_KEY) {
    const poolManager = new AgentPoolManager();
    deps.poolManager = poolManager;
    const factory: CustomAgentFactory<AgentSpec> = createCustomAgentFactory({
      model,
      wrenBin: config.WREN_BIN,
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
      provider: model.name,
      wrenBin: config.WREN_BIN,
      wrenProject: projectDir,
      domains: agents.map((a) => a.id),
      customAgents: agents.filter((a) => a.source === 'custom').length,
    },
    'dependencies initialized',
  );

  return deps;
}

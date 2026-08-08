import type { ModelProvider } from '@pi-wren/agent-sdk';
import {
  DataAnalysisAgent,
  WrenCliContextEngine,
  createDataAnalysisTools,
  type AgentDomainConfig,
  type MemoryStore,
} from '@pi-wren/agent-runtime';
import type { CustomAgentConfig, CustomAgentFactory } from '@pi-wren/agent-registry';
import { WrenCli, allowedTablesOf, loadWrenProject } from '@pi-wren/context-engine';
import { PostgresSqlExecutor } from '@pi-wren/data-engine';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentSpec } from './deps';
import type { AgentPoolManager } from './pool-manager';

/** 自定义 Agent 缺省系统提示词（与内置 Agent 一致的防幻觉要求）。 */
export const DEFAULT_CUSTOM_SYSTEM_PROMPT =
  '你是一名严谨的企业数据查询分析师。基于给定的查询结果，用提问相同的语言给出简洁的执行摘要：' +
  '先说明总体结论，再列出关键数据点与变化，最后给出 1-2 条建议。' +
  '必须严格依据查询结果作答，禁止编造、推测或补全数据中不存在的字段与数值。' +
  '所有日期、金额、数量必须与查询结果逐字一致，禁止改写、取整或推算。' +
  '数据中不包含的信息必须明确说明"数据中未包含"，不得臆测。';

/**
 * 自定义 Agent 构建器：WrenAI 工程 JSON → 落临时目录 → WrenCli → WrenCliContextEngine。
 * SQL 校验表名白名单自动来自工程声明的 models（table_reference）。
 */
export function createCustomAgentFactory(deps: {
  model: ModelProvider;
  wrenBin?: string;
  memory: MemoryStore;
  poolManager: AgentPoolManager;
}): CustomAgentFactory<AgentSpec> {
  return {
    async build(config: CustomAgentConfig): Promise<AgentSpec> {
      // 把 WrenAI 工程序列化 JSON 写到独立临时目录，作为 wren CLI 的工作目录
      const projectDir = materializeProject(config.agentId, config.projectJson);
      const cli = new WrenCli({ bin: deps.wrenBin, projectDir });
      const project = loadWrenProject(projectDir);
      const context = new WrenCliContextEngine({ model: deps.model, cli });
      // 独立连接池由 AgentPoolManager 统一管理（监控 + 更新/注销时释放）
      const sql = new PostgresSqlExecutor(deps.poolManager.create(config.agentId, config.db));
      const tools = createDataAnalysisTools(context, sql, allowedTablesOf(project));
      const domain: AgentDomainConfig = {
        id: config.agentId,
        label: config.label,
        description: config.description ?? `自定义数据查询 Agent（${config.name}）`,
        systemPrompt: config.systemPrompt ?? DEFAULT_CUSTOM_SYSTEM_PROMPT,
      };
      const agent = new DataAnalysisAgent({
        domain,
        context,
        sql,
        tools,
        model: deps.model,
        memory: deps.memory,
      });
      return {
        id: domain.id,
        label: domain.label,
        description: domain.description,
        agent,
        metrics: await context.listMetrics(),
        source: 'custom',
      };
    },
  };
}

/**
 * 把 WrenAI 工程序列化 JSON 写到临时目录。
 * projectJson 是 `wren context init --from-mdl` 产出的 MDL JSON（含 models/relationships）。
 */
function materializeProject(agentId: string, projectJson: string): string {
  const dir = join(tmpdir(), `pi-wren-agent-${agentId}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mdl.json'), projectJson, 'utf8');
  return dir;
}

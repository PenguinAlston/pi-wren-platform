import type { ModelProvider } from '@pi-wren/agent-sdk';
import {
  DataAnalysisAgent,
  LlmContextEngine,
  createDataAnalysisTools,
  type AgentDomainConfig,
  type MemoryStore,
} from '@pi-wren/agent-runtime';
import type { CustomAgentConfig, CustomAgentFactory } from '@pi-wren/agent-registry';
import { ConfigDrivenContextEngine, parseSemanticConfig } from '@pi-wren/context-engine';
import { PostgresSqlExecutor } from '@pi-wren/data-engine';
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
 * 自定义 Agent 构建器：MDL 字符串 → SemanticConfig（校验）→ 独立连接池
 * → 规则引擎（兜底）+ LLM 动态 SQL（可选）→ DataAnalysisAgent。
 * SQL 校验表名白名单自动来自 MDL 声明的 models，注册即隔离。
 */
export function createCustomAgentFactory(deps: {
  model?: ModelProvider;
  memory: MemoryStore;
  poolManager: AgentPoolManager;
}): CustomAgentFactory<AgentSpec> {
  return {
    async build(config: CustomAgentConfig): Promise<AgentSpec> {
      const semantic = parseSemanticConfig(config.mdl, `agent:${config.agentId}`);
      // 独立连接池由 AgentPoolManager 统一管理（监控 + 更新/注销时释放）
      const sql = new PostgresSqlExecutor(deps.poolManager.create(config.agentId, config.db));
      const configEngine = new ConfigDrivenContextEngine(semantic);
      const context = deps.model
        ? new LlmContextEngine({ model: deps.model, config: semantic, fallback: configEngine })
        : configEngine;
      const tools = createDataAnalysisTools(context, sql, semantic);
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

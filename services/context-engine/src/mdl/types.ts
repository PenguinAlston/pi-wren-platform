/**
 * MDL 式声明式语义配置（Modeling Definition Language style）。
 * 与 Wren AI 的语义建模思路对齐：模型(表) + 指标 + 业务知识 + 问题→SQL 意图。
 */

export interface SemanticColumn {
  name: string;
  type: string;
  label?: string;
}

export interface SemanticModel {
  name: string;
  table: string;
  description?: string;
  columns?: SemanticColumn[];
}

export interface SemanticIntent {
  name: string;
  keywords: string[];
  description?: string;
  sql: string;
}

export interface SemanticMetric {
  name: string;
  definition: string;
  unit?: string;
}

export interface SemanticConfig {
  /** 领域标识，如 finance / insurance */
  name: string;
  catalog?: string;
  schema?: string;
  models: SemanticModel[];
  /** 问题意图 → SQL 生成规则（按关键词匹配） */
  intents: SemanticIntent[];
  /** 业务指标定义 */
  metrics: SemanticMetric[];
  /** 企业业务知识（供检索） */
  knowledge: string[];
  /** 无匹配时使用的意图名 */
  defaultIntent?: string;
}

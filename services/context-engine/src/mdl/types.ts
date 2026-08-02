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

/** 意图查询形态：aggregate=聚合统计（默认），detail=明细列表（返回具体行）。 */
export type IntentKind = 'aggregate' | 'detail';

export interface SemanticIntent {
  name: string;
  keywords: string[];
  description?: string;
  sql: string;
  /** 查询形态：detail 用于"有哪些/明细/名单"类问题，aggregate 用于"多少/分布/统计"类问题。 */
  kind?: IntentKind;
  /** SQL 模板支持的参数占位符，如 ['year']：{year} 会被替换为年份谓词。 */
  params?: string[];
  /** 未提供年份参数时 {year} 的兜底谓词（如 '1=1' / 'p.end_date IS NOT NULL'）。 */
  yearFallback?: string;
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
  /** 问题意图 → SQL 生成规则（按关键词 + 问题要素匹配） */
  intents: SemanticIntent[];
  /** 业务指标定义 */
  metrics: SemanticMetric[];
  /** 企业业务知识（供检索） */
  knowledge: string[];
  /** 无匹配时使用的意图名 */
  defaultIntent?: string;
}

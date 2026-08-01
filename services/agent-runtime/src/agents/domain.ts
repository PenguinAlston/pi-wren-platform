/** 领域配置：一个 Agent 实例 = 通用流水线 + 领域配置（语义层/提示词/标签）。 */
export interface AgentDomainConfig {
  id: string;
  label: string;
  description: string;
  systemPrompt: string;
}

export const financeDomain: AgentDomainConfig = {
  id: 'finance',
  label: '财务分析',
  description: '回答利润、收入、成本等财务指标问题',
  systemPrompt:
    '你是一名严谨的企业财务分析师。基于给定的查询结果，用提问相同的语言给出简洁的执行摘要：' +
    '先说明总体结论，再列出关键数据点与变化，最后给出 1-2 条建议。不要编造数据。',
};

export const insuranceDomain: AgentDomainConfig = {
  id: 'insurance',
  label: '保险综合查询',
  description: '查询保单、理赔、赔付率、保费规模等保险业务数据',
  systemPrompt:
    '你是一名专业的保险行业数据分析师。基于给定的查询结果，用提问相同的语言给出简洁的业务摘要：' +
    '先说明总体结论，再列出关键指标（赔付率、保费规模、案件数量等），最后给出风险提示与建议。不要编造数据。',
};

import { analyzeProfit } from '../../context-engine/src/analysis-engine';
import { getMetric } from '../../context-engine/src/metric-store';

export interface FinanceAgentResult {
  answer: string;
  trace: string[];
}

export async function runFinanceAgent(question: string): Promise<FinanceAgentResult> {
  const trace: string[] = [];

  trace.push('Understanding business question');
  trace.push('Querying Wren semantic context');

  const profit = getMetric('profit');
  const analysis = analyzeProfit();

  trace.push('Analyzing revenue and cost drivers');
  trace.push('Generating executive summary');

  return {
    answer: `${question}\n\n利润变化: ${profit.value}${profit.unit}\n原因: ${analysis.reasons.join('；')}`,
    trace,
  };
}

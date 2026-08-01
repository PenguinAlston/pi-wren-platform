import { getMetric } from './metric-store';

export function analyzeProfit() {
  const profit = getMetric('profit');
  const cost = getMetric('cost');

  return {
    summary: `Profit changed ${Math.abs(Number(profit.value))}${profit.unit}`,
    reasons: [
      `Cost increased ${cost.value}${cost.unit}`,
      'Revenue performance requires further analysis',
    ],
  };
}

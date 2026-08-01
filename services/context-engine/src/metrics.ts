import type { MetricDefinition } from '@pi-wren/shared-types';

export const metrics: Record<string, MetricDefinition> = {
  profit: {
    name: 'profit',
    definition: 'Revenue minus cost and operating expenses',
    value: -12,
    unit: '%',
  },
  revenue: {
    name: 'revenue',
    definition: 'Recognized business revenue',
    value: -5,
    unit: '%',
  },
  cost: {
    name: 'cost',
    definition: 'Operational costs',
    value: 18,
    unit: '%',
  },
};

export function getMetric(name: string): MetricDefinition | undefined {
  return metrics[name];
}

export function listMetrics(): MetricDefinition[] {
  return Object.values(metrics);
}

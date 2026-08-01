export const financeContext = {
  metrics: {
    revenue: {
      name: 'revenue',
      definition: 'Total recognized business revenue',
    },
    profit: {
      name: 'profit',
      definition: 'Revenue minus cost and operating expenses',
    },
  },
};

export function findMetric(name: string) {
  return financeContext.metrics[name as keyof typeof financeContext.metrics];
}

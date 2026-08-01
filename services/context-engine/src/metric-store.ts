const metrics = {
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

export function getMetric(name: keyof typeof metrics) {
  return metrics[name];
}

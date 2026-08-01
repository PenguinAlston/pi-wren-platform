/**
 * Deterministic demo SQL generation used when no Wren AI service is configured.
 * Maps common finance questions to queries against the finance_fact table.
 */
export function generateDemoSQL(question: string): string {
  const q = question.toLowerCase();

  if (/(利润|profit)/.test(q)) {
    return 'SELECT quarter, revenue, cost, profit FROM finance_fact ORDER BY quarter;';
  }
  if (/(收入|营收|revenue)/.test(q)) {
    return 'SELECT quarter, revenue FROM finance_fact ORDER BY quarter;';
  }
  if (/(成本|cost)/.test(q)) {
    return 'SELECT quarter, cost FROM finance_fact ORDER BY quarter;';
  }
  if (/(毛利|margin)/.test(q)) {
    return 'SELECT quarter, profit, revenue FROM finance_fact ORDER BY quarter;';
  }

  return 'SELECT quarter, revenue, cost, profit FROM finance_fact ORDER BY quarter;';
}

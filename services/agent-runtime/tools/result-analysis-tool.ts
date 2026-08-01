export function analyzeQueryResult(rows: Record<string, unknown>[]) {
  if (!rows.length) {
    return 'No data found';
  }

  return {
    summary: 'Query executed successfully',
    rows,
  };
}

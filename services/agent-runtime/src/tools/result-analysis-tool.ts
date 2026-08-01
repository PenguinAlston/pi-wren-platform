export interface AnalysisResult {
  summary: string;
  observations: string[];
  table: Record<string, unknown>[];
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numericColumns(rows: Record<string, unknown>[]): string[] {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (toNumber(value) !== undefined) {
        columns.add(key);
      }
    }
  }
  return [...columns];
}

function formatDelta(current: number, previous: number): string {
  const delta = current - previous;
  const pct = previous === 0 ? 0 : (delta / Math.abs(previous)) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
}

/**
 * Deterministic, rule-based analysis of query results.
 * Used as a fallback when no LLM is configured; the LLM summarizer can build on it.
 */
export function analyzeQueryResult(
  rows: Record<string, unknown>[],
  _question: string,
): AnalysisResult {
  if (rows.length === 0) {
    return { summary: '查询未返回任何数据。', observations: [], table: [] };
  }

  const observations: string[] = [];
  const columns = numericColumns(rows);

  for (let i = 1; i < rows.length; i += 1) {
    const current = rows[i] ?? {};
    const previous = rows[i - 1] ?? {};
    for (const column of columns) {
      const currentValue = toNumber(current[column]);
      const previousValue = toNumber(previous[column]);
      if (currentValue !== undefined && previousValue !== undefined) {
        observations.push(
          `${String(current['quarter'] ?? `row ${i + 1}`)} 相对上一期 ${column} 变化：${formatDelta(currentValue, previousValue)}`,
        );
      }
    }
  }

  const summary =
    observations.length > 0
      ? `查询返回 ${rows.length} 行。${observations.join(' ')}`
      : `查询返回 ${rows.length} 行，未检测到明显的变化趋势。`;

  return { summary, observations, table: rows };
}

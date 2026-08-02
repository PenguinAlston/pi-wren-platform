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
      if (!isCodeLikeColumn(key) && toNumber(value) !== undefined) {
        columns.add(key);
      }
    }
  }
  return [...columns];
}

/** 时间序列列识别（quarter/month/year/date 等），命中则做环比变化分析。 */
/** 代码型列（字典编码）不作为数值分析列，也不作为数值参与运算 */
function isCodeLikeColumn(name: string): boolean {
  return /(_type|_status|_code|_no|_id|type|status|code|no)$/i.test(name);
}

function isPeriodColumn(name: string): boolean {
  const n = name.toLowerCase();
  return (
    // 整词匹配，避免 year_premium、date_of_birth 等含前缀字段被误判为时间列
    /^(quarter|month|year|week|date|period|q[1-4]|季度|月份|年份|日期|期间)$/.test(n) ||
    /^(20\d{2}|19\d{2})[_-]?q[1-4]$/.test(n) || // 2024q1 / 2024-Q1
    /^\d{4}$/.test(n) || // 2024
    /^\d{4}[_-]\d{1,2}$/.test(n) // 2024-05
  );
}

function findPeriodColumn(row: Record<string, unknown>): string | undefined {
  const keys = Object.keys(row);
  return keys.find((key) => isPeriodColumn(key)) ?? keys.find((key) => /^q[1-4]$/i.test(key));
}

function formatDelta(current: number, previous: number): string {
  const delta = current - previous;
  const pct = previous === 0 ? 0 : (delta / Math.abs(previous)) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
}

/** 分组数据：计算每行数值占合计的比例，识别最高/最低项。 */
function buildShareObservations(
  rows: Record<string, unknown>[],
  labelColumn: string,
  columns: string[],
): string[] {
  const observations: string[] = [];
  for (const column of columns) {
    const total = rows.reduce((sum, row) => sum + (toNumber(row[column]) ?? 0), 0);
    if (total === 0) {
      continue;
    }
    const ranked = rows
      .map((row) => ({
        label: String(row[labelColumn] ?? '未知'),
        value: toNumber(row[column]) ?? 0,
      }))
      .sort((a, b) => b.value - a.value);

    const top = ranked[0];
    const second = ranked[1];
    if (top) {
      const share = (top.value / total) * 100;
      observations.push(`${top.label} 的 ${column} 最高（${top.value.toFixed(0)}，占比 ${share.toFixed(1)}%）`);
    }
    if (second && second.value > 0) {
      const gap = ((top?.value ?? 0) - second.value) / (top?.value ?? 1);
      if (gap > 0.5) {
        observations.push(`${top?.label} 的 ${column} 显著高于第二名 ${second.label}（高出 ${(gap * 100).toFixed(0)}%）`);
      }
    }
  }
  return observations;
}

/**
 * 通用查询结果分析：
 * - 含时间列 → 逐期环比变化观察；
 * - 分组数据（无时间列） → 占比 / 排名观察；
 * - 始终返回行数摘要。
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
  const periodColumn = findPeriodColumn(rows[0] ?? {});

  if (periodColumn && rows.length > 1) {
    for (let i = 1; i < rows.length; i += 1) {
      const current = rows[i] ?? {};
      const previous = rows[i - 1] ?? {};
      for (const column of columns) {
        const currentValue = toNumber(current[column]);
        const previousValue = toNumber(previous[column]);
        if (currentValue !== undefined && previousValue !== undefined) {
          observations.push(
            `${String(current[periodColumn] ?? `row ${i + 1}`)} 相对上一期 ${column} 变化：${formatDelta(currentValue, previousValue)}`,
          );
        }
      }
    }
  } else {
    // 分组数据：标签列优先选代码型列（product_type/status 等），其次第一个非数值列
    const firstRow = rows[0] ?? {};
    const labelColumn =
      Object.keys(firstRow).find((key) => isCodeLikeColumn(key)) ??
      Object.keys(firstRow).find((key) => toNumber(firstRow[key]) === undefined) ??
      'row';
    observations.push(...buildShareObservations(rows, labelColumn, columns));
  }

  const summary =
    observations.length > 0
      ? `查询返回 ${rows.length} 行。${observations.join(' ')}`
      : `查询返回 ${rows.length} 行，未检测到明显特征。`;

  return { summary, observations, table: rows };
}

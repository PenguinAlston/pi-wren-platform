/** AI 问答页纯工具函数：图表类型识别 / CSV 导出 / 时间与单元格格式化。 */

export type ChartKind = 'line' | 'bar' | 'pie';

export interface ChartSpec {
  type: ChartKind;
  labelKey: string;
  valueKeys: string[];
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

/** 代码型列（字典编码/编号）不作为数值参与图表。 */
function isCodeLikeColumn(key: string): boolean {
  return /(_type|_status|_code|_no|_id|type|status|code|no)$/i.test(key);
}

/** ID/编号列（保单号、报案号等）不适合做图表图例。 */
function isIdLikeColumn(key: string): boolean {
  return /(_id|_no|_code)$/i.test(key) || key === 'id';
}

/** 标签列是否为周期/时间（年份、季度、月份、日期），命中则用折线图。 */
function isPeriodValue(value: string): boolean {
  return (
    /^\d{4}$/.test(value) ||
    /^\d{4}[-/]\d{1,2}(-\d{1,2})?$/.test(value) ||
    /^(19|20)\d{2}\s?q[1-4]$/i.test(value) ||
    /^q[1-4]$/i.test(value)
  );
}

/**
 * 根据查询结果自动适配图表（需求 4.3.2-3）：
 * - 时间/周期列 → 折线图；单数值列且类别 ≤ 8 → 饼图；其余 → 柱状图。
 * - 无法识别（无标签列或无数值列）返回 null，前端只渲染表格。
 */
export function detectChart(rows: Record<string, unknown>[]): ChartSpec | null {
  if (rows.length === 0) {
    return null;
  }
  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  const numericKeys = keys.filter((key) => !isCodeLikeColumn(key) && toNumber(first[key]) !== undefined);
  // 标签列必须是真正可分类的字段：非数值、非对象、非 ID/编号（policy_no 之类不适合做图例）
  const labelKey = keys.find(
    (key) => !isIdLikeColumn(key) && typeof first[key] !== 'object' && toNumber(first[key]) === undefined,
  );
  if (!labelKey || numericKeys.length === 0) {
    return null;
  }
  const valueKeys = numericKeys.slice(0, 3);
  const labelValues = rows.map((row) => String(row[labelKey] ?? ''));
  const isPeriod = labelValues.some((value) => isPeriodValue(value));
  const type: ChartKind = isPeriod ? 'line' : valueKeys.length === 1 && rows.length <= 8 ? 'pie' : 'bar';
  return { type, labelKey, valueKeys };
}

/** 单元格格式化：金额/数字加千分位，其余原样。 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toLocaleString('zh-CN');
  }
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && value.length <= 18) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      const [intPart = ''] = value.split('.');
      if (value.includes('.') || intPart.length >= 4) {
        return number.toLocaleString('zh-CN', {
          minimumFractionDigits: value.includes('.') ? 2 : 0,
        });
      }
    }
  }
  return String(value);
}

/** CSV 序列化（UTF-8，特殊字符加引号）。 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0] ?? {});
  const escapeCell = (value: unknown): string => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  }
  return lines.join('\n');
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / MM-DD。 */
export function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return '';
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)} 小时前`;
  }
  if (diff < 7 * 86_400_000) {
    return `${Math.floor(diff / 86_400_000)} 天前`;
  }
  return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

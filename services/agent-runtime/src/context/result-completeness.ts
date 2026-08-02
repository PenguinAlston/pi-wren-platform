/**
 * 查询结果完整性自检：把"用户明确要求的字段"与"本次查询返回的列"做对比，
 * 缺失时触发自动重查/澄清，避免把"SQL 没取到"说成"数据不存在"。
 */

export interface RequestedField {
  id: string;
  label: string;
}

const REQUESTED_FIELD_PATTERNS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: 'policy_no', label: '保单号码', pattern: /保单号|保单号码|保单编号|号码/ },
  { id: 'insured_name', label: '被保人姓名', pattern: /被保人|被保险人|姓名/ },
];

/** 结果列别名（pg 返回小写蛇形列名，兼容不同别名写法）。 */
const COLUMN_ALIASES: Record<string, string[]> = {
  policy_no: ['policy_no', 'policyno', 'policy_number'],
  insured_name: ['insured_name', 'insuredname', 'customer_name', 'customername'],
};

/** 从问题中抽取用户明确要求返回的字段。 */
export function requestedFields(question: string): RequestedField[] {
  return REQUESTED_FIELD_PATTERNS.filter((field) => field.pattern.test(question));
}

/** 检查查询结果中缺少哪些用户要求返回的字段。 */
export function missingRequestedFields(
  question: string,
  rows: Record<string, unknown>[],
): RequestedField[] {
  if (rows.length === 0) {
    // 空结果无从判断列，视为缺失（触发重查，仍有空再如实说明）
    return requestedFields(question);
  }
  const columns = new Set(Object.keys(rows[0] ?? {}).map((c) => c.toLowerCase()));
  return requestedFields(question).filter((field) => {
    const aliases = COLUMN_ALIASES[field.id] ?? [];
    return !aliases.some((alias) => columns.has(alias));
  });
}

/** 构造重查提示：在原问题后补充必须返回的明细字段。 */
export function buildRepairQuestion(question: string, missing: RequestedField[]): string {
  const labels = missing.map((m) => m.label).join('、');
  return `${question}（注意：查询结果必须包含 ${labels} 等明细字段，请按用户条件查询）`;
}

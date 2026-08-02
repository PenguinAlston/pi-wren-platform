/**
 * 业务数据脱敏（需求 7.3）：身份证/手机号部分隐藏。
 * 在 API 出口统一应用，前端与日志均不接触明文。
 */

/** 证件号：保留前 6 位 + 后 4 位，中间打码。 */
export function maskIdNo(idNo: string): string {
  const value = String(idNo ?? '');
  if (value.length <= 8) {
    return value.replace(/[0-9A-Za-z]/g, '*');
  }
  return `${value.slice(0, 6)}${'*'.repeat(value.length - 10)}${value.slice(-4)}`;
}

/** 手机号：保留前 3 位 + 后 4 位。 */
export function maskPhone(phone: string): string {
  const value = String(phone ?? '');
  if (value.length < 7) {
    return value.replace(/\d/g, '*');
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

/** 敏感列统一脱敏（列表/详情通用，命中即处理）。 */
const SENSITIVE_COLUMNS = new Set([
  'id_no',
  'id_card',
  'phone',
  'applicant_id_no',
  'insured_id_no',
  'applicant_phone',
  'insured_phone',
  'customer_id_no',
  'customer_phone',
]);

export function maskRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (!SENSITIVE_COLUMNS.has(key) || typeof value !== 'string') {
      continue;
    }
    result[key] = key.endsWith('_phone') || key === 'phone' ? maskPhone(value) : maskIdNo(value);
  }
  return result;
}

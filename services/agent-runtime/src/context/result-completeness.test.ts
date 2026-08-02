import { describe, expect, it } from 'vitest';
import {
  buildRepairQuestion,
  missingRequestedFields,
  requestedFields,
} from './result-completeness';

describe('result completeness (P1)', () => {
  it('extracts requested detail fields from the question', () => {
    const fields = requestedFields('2025终止的保单有哪些？同时告诉我被保人的姓名和保单号码');
    expect(fields.map((f) => f.id).sort()).toEqual(['insured_name', 'policy_no']);
    expect(requestedFields('保单状态分布如何？')).toEqual([]);
  });

  it('reports missing fields when the result lacks the requested columns', () => {
    const rows = [{ policy_status: '承保有效', policy_count: 7 }];
    const missing = missingRequestedFields('告诉我被保人的姓名和保单号码', rows);
    expect(missing.map((m) => m.id).sort()).toEqual(['insured_name', 'policy_no']);
  });

  it('accepts detail columns when present (snake or camel case)', () => {
    const rows = [{ policy_no: 'P20240002', insured_name: '刘美玲', end_date: '2025-03-31' }];
    expect(missingRequestedFields('告诉我被保人的姓名和保单号码', rows)).toEqual([]);

    const camelRows = [{ policyNo: 'P20240002', insuredName: '刘美玲' }];
    expect(missingRequestedFields('告诉我被保人的姓名和保单号码', camelRows)).toEqual([]);
  });

  it('builds a repair question that forces detail fields', () => {
    const missing = requestedFields('保单有哪些？同时告诉我被保人的姓名和保单号码');
    const repaired = buildRepairQuestion('保单有哪些？同时告诉我被保人的姓名和保单号码', missing);
    expect(repaired).toContain('保单号码');
    expect(repaired).toContain('被保人姓名');
    expect(repaired).toContain('明细字段');
  });
});

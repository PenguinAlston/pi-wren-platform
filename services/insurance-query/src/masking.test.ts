import { describe, expect, it } from 'vitest';
import { maskIdNo, maskPhone, maskRow } from './masking';

describe('maskIdNo', () => {
  it('keeps first 6 and last 4 digits', () => {
    expect(maskIdNo('110101199001011234')).toBe('110101********1234');
  });

  it('masks short values entirely', () => {
    expect(maskIdNo('123456')).toBe('******');
  });
});

describe('maskPhone', () => {
  it('keeps first 3 and last 4 digits', () => {
    expect(maskPhone('13812345678')).toBe('138****5678');
  });
});

describe('maskRow', () => {
  it('masks sensitive columns and leaves others untouched', () => {
    const row = maskRow({
      policy_no: 'P20240001',
      applicant_id_no: '110101199001011234',
      applicant_phone: '13812345678',
      insured_id_no: '110101199202021234',
      year_premium: 5200,
      label: '承保有效',
    });
    expect(row.policy_no).toBe('P20240001');
    expect(row.applicant_id_no).toBe('110101********1234');
    expect(row.applicant_phone).toBe('138****5678');
    expect(row.insured_id_no).toBe('110101********1234');
    expect(row.year_premium).toBe(5200);
    expect(row.label).toBe('承保有效');
  });

  it('does not mutate the input row', () => {
    const input = { phone: '13812345678' };
    maskRow(input);
    expect(input.phone).toBe('13812345678');
  });
});

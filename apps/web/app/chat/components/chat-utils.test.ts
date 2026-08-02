import { describe, expect, it } from 'vitest';
import { detectChart, formatCell, toCsv } from './chat-utils';

describe('detectChart', () => {
  it('detects pie for single value with few categories', () => {
    const spec = detectChart([
      { product_type: '重疾险', claim_count: 12 },
      { product_type: '医疗险', claim_count: 8 },
    ]);
    expect(spec?.type).toBe('pie');
    expect(spec?.labelKey).toBe('product_type');
  });

  it('detects line for period label column', () => {
    const spec = detectChart([
      { month: '2024-01', amount: 100 },
      { month: '2024-02', amount: 120 },
    ]);
    expect(spec?.type).toBe('line');
  });

  it('detects bar for multiple value columns', () => {
    const spec = detectChart([
      { region: '北京', revenue: 100, cost: 60 },
      { region: '上海', revenue: 200, cost: 90 },
    ]);
    expect(spec?.type).toBe('bar');
    expect(spec?.valueKeys).toEqual(['revenue', 'cost']);
  });

  it('returns null for code-like numeric columns or empty data', () => {
    expect(detectChart([{ policy_no: 'P20240001', year_premium: 5200 }])).toBeNull();
    expect(detectChart([])).toBeNull();
    expect(detectChart([{ label: 'x' }])).toBeNull();
  });
});

describe('toCsv', () => {
  it('serializes rows with escaping and ignores empty data', () => {
    const csv = toCsv([
      { name: '重疾险', ratio: '45.00' },
      { name: '医,疗', ratio: '30.00' },
    ]);
    expect(csv).toContain('name,ratio');
    expect(csv).toContain('"医,疗"');
    expect(toCsv([])).toBe('');
  });
});

describe('formatCell', () => {
  it('formats amounts and keeps short codes as-is', () => {
    expect(formatCell('5200.00')).toBe('5,200.00');
    expect(formatCell('02')).toBe('02');
    expect(formatCell('P20240001')).toBe('P20240001');
    expect(formatCell(null)).toBe('');
  });
});

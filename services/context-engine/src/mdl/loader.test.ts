import { describe, expect, it } from 'vitest';
import { parseSemanticConfig } from './loader';

const sample = `
name: test
models:
  - name: orders
    table: orders
    columns:
      - { name: id, type: integer }
intents:
  - name: overview
    keywords: [订单, order]
    sql: SELECT * FROM orders;
metrics:
  - name: order_count
    definition: 订单数量
knowledge:
  - 订单表
defaultIntent: overview
`;

describe('parseSemanticConfig', () => {
  it('parses a valid YAML semantic config', () => {
    const config = parseSemanticConfig(sample, 'test.yml');

    expect(config.name).toBe('test');
    expect(config.models).toHaveLength(1);
    expect(config.models[0]?.table).toBe('orders');
    expect(config.intents[0]?.sql).toContain('orders');
    expect(config.metrics[0]?.name).toBe('order_count');
    expect(config.knowledge).toEqual(['订单表']);
    expect(config.defaultIntent).toBe('overview');
  });

  it('throws when name is missing', () => {
    expect(() => parseSemanticConfig('models: []\nintents: []', 'bad.yml')).toThrow(/name/);
  });

  it('throws when an intent lacks sql', () => {
    const bad = `
name: test
models:
  - { name: m, table: t }
intents:
  - name: x
    keywords: [a]
`;
    expect(() => parseSemanticConfig(bad, 'bad.yml')).toThrow(/intents/);
  });
});

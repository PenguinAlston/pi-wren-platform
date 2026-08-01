import { describe, expect, it } from 'vitest';
import { PostgresSqlExecutor } from './sql-runner';

const fakePool = {
  query: async () => ({ rows: [{ quarter: 'Q1' }], rowCount: 1 }),
};

describe('PostgresSqlExecutor', () => {
  it('executes SQL and returns rows and count', async () => {
    const executor = new PostgresSqlExecutor(fakePool as never);
    const result = await executor.query('SELECT * FROM finance_fact');

    expect(result.rows).toEqual([{ quarter: 'Q1' }]);
    expect(result.count).toBe(1);
  });
});

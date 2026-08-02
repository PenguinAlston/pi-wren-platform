import { describe, expect, it, vi } from 'vitest';
import { NoopAuditLogger, PostgresOperationAuditLogger } from './audit';

function mockPool() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query } as unknown as {
    query: ReturnType<typeof vi.fn>;
  };
}

describe('OperationAuditLogger', () => {
  it('writes an audit entry to sys_operation_log', async () => {
    const pool = mockPool();
    const logger = new PostgresOperationAuditLogger(pool as never, 'UADMIN');
    await logger.log({
      operType: 'agent_register',
      operContent: '注册自定义 Agent：my-erp',
      sqlContent: 'mdl=1024 chars',
      ipAddress: '127.0.0.1',
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO sys_operation_log');
    expect(params?.[1]).toBe('UADMIN');
    expect(params?.[2]).toBe('agent_register');
    expect(params?.[5]).toBe('127.0.0.1');
  });

  it('never throws when the insert fails (audit must not block business)', async () => {
    const pool = mockPool();
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const logger = new PostgresOperationAuditLogger(pool as never);
    await expect(logger.log({ operType: 'agent_delete', operContent: 'x' })).resolves.toBeUndefined();
  });

  it('NoopAuditLogger does nothing', async () => {
    await expect(new NoopAuditLogger().log({ operType: 'x', operContent: 'y' })).resolves.toBeUndefined();
  });
});

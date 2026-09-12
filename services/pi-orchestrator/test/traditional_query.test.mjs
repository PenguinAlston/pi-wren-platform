import { describe, expect, it } from 'vitest';
import { createTraditionalQueryTool } from '../src/tools/traditional_query.mjs';

const options = { backendUrl: 'http://py:8080', internalToken: 'tok' };

function mockFetch(status, data) {
  return async (url, init) => {
    mockFetch.last = { url, init };
    return { ok: status < 400, status, json: async () => data };
  };
}
mockFetch.last = null;

describe('traditional_query tool', () => {
  it('成功：透传 module/conditions，LLM 拿截断 rows，details 带全量', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ policy_no: `P${i}` }));
    const tool = createTraditionalQueryTool({
      ...options,
      sampleRowLimit: 10,
      fetchImpl: mockFetch(200, { items: rows, total: 25, page: 2, pageSize: 25, totalPages: 1 }),
    });
    const result = await tool.execute('id1', { module: 'contract', conditions: { policyNo: 'P' }, page: 2, pageSize: 25 });

    const { url, init } = mockFetch.last;
    expect(url).toBe('http://py:8080/internal/traditional/query?module=contract');
    expect(init.headers['x-internal-token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ conditions: { policyNo: 'P' }, page: 2, pageSize: 25 });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(25);
    expect(payload.sampleRows).toHaveLength(10);
    expect(result.details.rows).toHaveLength(25);
    expect(result.details.module).toBe('contract');
  });

  it('后端错误：ok=false 带错误信息', async () => {
    const tool = createTraditionalQueryTool({ ...options, fetchImpl: mockFetch(403, { error: '未分配机构' }) });
    const result = await tool.execute('id1', { module: 'claim' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: '未分配机构' });
  });

  it('未传 conditions/page：默认值', async () => {
    const tool = createTraditionalQueryTool({
      ...options,
      fetchImpl: mockFetch(200, { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 }),
    });
    await tool.execute('id1', { module: 'preserve' });
    expect(JSON.parse(mockFetch.last.init.body)).toEqual({ conditions: {}, page: 1, pageSize: 10 });
  });
});

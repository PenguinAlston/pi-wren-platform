import { describe, expect, it } from 'vitest';
import { createGraphQueryTool } from '../src/tools/graph_query.mjs';

const options = { backendUrl: 'http://py:8080', internalToken: 'tok' };

function mockFetch(status, data) {
  return async (url) => {
    mockFetch.last = { url };
    return { ok: status < 400, status, json: async () => data };
  };
}
mockFetch.last = null;

const OVERVIEW = {
  categories: [{ name: '机构' }],
  stats: { nodeCount: 30, edgeCount: 40, labels: { Org: 5, Policy: 11 } },
  nodes: [{ id: 'Org:O1', label: 'Org', name: '总公司', props: { gid: 'O1' } }],
  edges: [],
};

const NEIGHBORS = {
  nodes: [
    { id: 'Policy:P1', label: 'Policy', name: 'P20240003', props: { gid: 'P1' } },
    { id: 'Customer:C1', label: 'Customer', name: '王大力', props: { gid: 'C1' } },
  ],
  edges: [{ source: 'Customer:C1', relation: 'HOLDS', target: 'Policy:P1' }],
};

describe('graph_query tool', () => {
  it('overview：返回统计与提示，details 带全图', async () => {
    const tool = createGraphQueryTool({ ...options, fetchImpl: mockFetch(200, OVERVIEW) });
    const result = await tool.execute('id1', { action: 'overview' });
    expect(mockFetch.last.url).toBe('http://py:8080/internal/graph/overview');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.stats.nodeCount).toBe(30);
    expect(payload.hint).toContain('neighbors');
    expect(result.details.nodes).toHaveLength(1);
  });

  it('neighbors：LLM 拿节点/关系摘要，details 带子图', async () => {
    const tool = createGraphQueryTool({ ...options, fetchImpl: mockFetch(200, NEIGHBORS) });
    const result = await tool.execute('id1', { action: 'neighbors', label: 'Policy', gid: 'P1' });
    expect(mockFetch.last.url).toBe('http://py:8080/internal/graph/neighbors?label=Policy&gid=P1');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.nodeCount).toBe(2);
    expect(payload.relations[0]).toBe('Customer:C1 -[HOLDS]-> Policy:P1');
    expect(result.details.nodes).toHaveLength(2);
  });

  it('neighbors 缺参数：ok=false', async () => {
    const tool = createGraphQueryTool({ ...options, fetchImpl: mockFetch(200, {}) });
    const result = await tool.execute('id1', { action: 'neighbors' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false });
  });

  it('未知 action：ok=false', async () => {
    const tool = createGraphQueryTool({ ...options, fetchImpl: mockFetch(200, {}) });
    const result = await tool.execute('id1', { action: 'delete' });
    expect(JSON.parse(result.content[0].text).error).toContain('未知 action');
  });

  it('图服务不可用：ok=false 透传错误', async () => {
    const tool = createGraphQueryTool({ ...options, fetchImpl: mockFetch(503, { error: '图数据库不可用' }) });
    const result = await tool.execute('id1', { action: 'overview' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: '图数据库不可用' });
  });
});

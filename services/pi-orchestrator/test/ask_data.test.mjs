import { describe, expect, it } from 'vitest';
import { createAskDataTool } from '../src/tools/ask_data.mjs';

describe('ask_data tool', () => {
  const options = { backendUrl: 'http://py:8080', internalToken: 'tok' };

  it('成功：LLM 拿截断 sampleRows，details 携带全量行（UI 通道）', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ i }));
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ answer: 'A', sql: 'SELECT 1', data: rows, durationMs: 5 }),
      };
    };
    const tool = createAskDataTool({ ...options, fetchImpl });
    const result = await tool.execute('id1', { question: '各险种赔付率？' });
    const payload = JSON.parse(result.content[0].text);
    expect(captured.url).toBe('http://py:8080/internal/agent/insurance/chat');
    expect(captured.init.headers['x-internal-token']).toBe('tok');
    expect(JSON.parse(captured.init.body)).toEqual({ message: '各险种赔付率？' });
    expect(payload.ok).toBe(true);
    expect(payload.rowCount).toBe(30);
    expect(payload.sampleRows).toHaveLength(10);
    // details 通道：全量行 + SQL，供前端结构化表格（不进模型载荷）
    expect(result.details.rows).toHaveLength(30);
    expect(result.details.sql).toBe('SELECT 1');
    expect(result.details.rowCount).toBe(30);
  });

  it('后端 4xx/5xx：ok=false 带错误信息', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: '数据权限不足' }) });
    const tool = createAskDataTool({ ...options, fetchImpl });
    const result = await tool.execute('id1', { question: 'q' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: '数据权限不足' });
  });

  it('网络异常：ok=false', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    const tool = createAskDataTool({ ...options, fetchImpl });
    const result = await tool.execute('id1', { question: 'q' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });

  it('超时：ok=false 查询超时', async () => {
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    const tool = createAskDataTool({ ...options, timeoutMs: 10, fetchImpl });
    const result = await tool.execute('id1', { question: 'q' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: '查询超时' });
  });
});

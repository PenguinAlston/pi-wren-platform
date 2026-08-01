import { afterEach, describe, expect, it, vi } from 'vitest';
import { WrenAIClient } from './client';

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WrenAIClient', () => {
  it('returns the generated SQL and sends an auth header when a token is set', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sql: 'SELECT 1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WrenAIClient({ endpoint: 'http://wren:8000', token: 't0ken' });
    const result = await client.generateSQL('利润');

    expect(result).toEqual({ sql: 'SELECT 1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://wren:8000/v1/generate_sql',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer t0ken' }),
      }),
    );
  });

  it('returns an error object when the service is unavailable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);

    const client = new WrenAIClient({ endpoint: 'http://wren:8000' });
    const result = await client.generateSQL('利润');

    expect(result.error).toContain('503');
  });
});

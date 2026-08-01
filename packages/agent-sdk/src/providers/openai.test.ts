import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai';
import { ModelProviderError } from '../model';

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIProvider', () => {
  it('returns the assistant message from a successful response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'hello' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const result = await provider.chat([{ role: 'user', content: 'hi' }]);

    expect(result.role).toBe('assistant');
    expect(result.content).toBe('hello');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
  });

  it('throws ModelProviderError on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIProvider({ apiKey: 'bad' });
    await expect(provider.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      ModelProviderError,
    );
  });
});

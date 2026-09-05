import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.mjs';

const BASE = { INTERNAL_API_TOKEN: 't', OPENAI_API_KEY: 'k' };

describe('loadConfig', () => {
  it('默认值', () => {
    const c = loadConfig(BASE);
    expect(c.port).toBe(8090);
    expect(c.backendUrl).toBe('http://127.0.0.1:8080');
    expect(c.maxToolCalls).toBe(8);
    expect(c.maxDurationMs).toBe(175_000);
  });
  it('缺 token 抛错', () => {
    expect(() => loadConfig({})).toThrow('INTERNAL_API_TOKEN');
  });
  it('缺 apiKey 抛错', () => {
    expect(() => loadConfig({ INTERNAL_API_TOKEN: 't' })).toThrow('OPENAI_API_KEY');
  });
});

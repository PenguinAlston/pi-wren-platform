import { describe, expect, it } from 'vitest';
import { createModelProvider } from './index';
import { MockProvider } from './providers/mock';
import { OpenAIProvider } from './providers/openai';

describe('createModelProvider', () => {
  it('creates a mock provider by default', () => {
    expect(createModelProvider({ kind: 'mock' })).toBeInstanceOf(MockProvider);
  });

  it('creates an OpenAI provider when an API key is present', () => {
    expect(createModelProvider({ kind: 'openai', apiKey: 'sk-test' })).toBeInstanceOf(
      OpenAIProvider,
    );
  });

  it('throws when an API key is missing for OpenAI', () => {
    expect(() => createModelProvider({ kind: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });
});

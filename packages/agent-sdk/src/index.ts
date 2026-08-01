import { AnthropicProvider } from './providers/anthropic';
import { MockProvider } from './providers/mock';
import { OllamaProvider } from './providers/ollama';
import { OpenAIProvider } from './providers/openai';
import type { ModelProvider, ModelProviderConfig, ProviderKind } from './model';

export * from './model';
export { AnthropicProvider, MockProvider, OllamaProvider, OpenAIProvider };

/** Build a provider from an explicit config object. */
export function createModelProvider(config: ModelProviderConfig): ModelProvider {
  switch (config.kind) {
    case 'mock':
      return new MockProvider();
    case 'openai':
      if (!config.apiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      }
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case 'anthropic':
      if (!config.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
      }
      return new AnthropicProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
      });
    case 'ollama':
      return new OllamaProvider({ baseUrl: config.baseUrl, model: config.model });
    default:
      throw new Error(`Unknown LLM provider: ${String(config.kind)}`);
  }
}

/** Build a provider from environment variables (defaults to the mock provider). */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const kind = (env.LLM_PROVIDER ?? 'mock') as ProviderKind;
  return createModelProvider({
    kind,
    apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY,
    baseUrl: env.OPENAI_BASE_URL ?? env.OLLAMA_BASE_URL,
    model: env.OPENAI_MODEL ?? env.ANTHROPIC_MODEL ?? env.OLLAMA_MODEL,
  });
}

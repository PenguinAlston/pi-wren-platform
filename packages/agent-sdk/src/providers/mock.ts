import type { ChatMessage } from '@pi-wren/shared-types';
import { truncate, type ChatOptions, type ModelProvider } from '../model';

/**
 * Deterministic offline provider used when no real LLM is configured.
 * Keeps the full pipeline runnable for demos and tests.
 */
export class MockProvider implements ModelProvider {
  readonly name = 'mock' as const;

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<ChatMessage> {
    const last = messages.at(-1)?.content ?? '';
    return {
      role: 'assistant',
      content: `[mock-llm] Acknowledged: ${truncate(last, 120)}`,
    };
  }
}

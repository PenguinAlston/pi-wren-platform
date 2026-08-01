import type { ChatMessage } from '@pi-wren/shared-types';

export type ProviderKind = 'mock' | 'openai' | 'anthropic' | 'ollama';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ModelProvider {
  /** Stable identifier, e.g. "openai". */
  readonly name: ProviderKind;
  /** Single-turn completion for the given message history. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatMessage>;
  /** Optional streaming completion. */
  stream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatMessage>;
}

export interface ModelProviderConfig {
  kind: ProviderKind;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class ModelProviderError extends Error {
  readonly provider: string;
  readonly status?: number;

  constructor(message: string, provider: string, status?: number) {
    super(message);
    this.name = 'ModelProviderError';
    this.provider = provider;
    this.status = status;
  }
}

/** Truncate long content for logs and fallback messages. */
export function truncate(text: string, maxLength = 200): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

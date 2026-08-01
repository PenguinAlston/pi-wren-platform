import type { ChatMessage } from '@pi-wren/shared-types';
import { ModelProviderError, type ChatOptions, type ModelProvider } from '../model';

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
  error?: { message?: string };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/** Anthropic Messages API client. */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const;

  constructor(private readonly opts: AnthropicProviderOptions) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatMessage> {
    const baseUrl = this.opts.baseUrl ?? 'https://api.anthropic.com';
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    const body = {
      model: this.opts.model ?? 'claude-3-5-haiku-latest',
      max_tokens: options?.maxTokens ?? 1024,
      temperature: options?.temperature ?? 0.2,
      system: system || undefined,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
    };

    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new ModelProviderError(
        `Anthropic request failed (${response.status})`,
        'anthropic',
        response.status,
      );
    }

    const data = (await response.json()) as AnthropicResponse;
    if (data.error?.message) {
      throw new ModelProviderError(data.error.message, 'anthropic');
    }

    const text = data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (!text) {
      throw new ModelProviderError('Anthropic returned an empty response', 'anthropic');
    }

    return { role: 'assistant', content: text };
  }
}

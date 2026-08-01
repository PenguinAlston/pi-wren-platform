import type { ChatMessage } from '@pi-wren/shared-types';
import { ModelProviderError, type ChatOptions, type ModelProvider } from '../model';

interface OpenAIResponse {
  choices?: { message?: { role?: string; content?: string | null } }[];
  error?: { message?: string };
}

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

/** OpenAI-compatible Chat Completions client (works with OpenAI, DeepSeek, etc.). */
export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai' as const;

  constructor(private readonly opts: OpenAIProviderOptions) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatMessage> {
    const baseUrl = this.opts.baseUrl ?? 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: this.opts.model ?? 'gpt-4o-mini',
        messages,
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens,
        stream: false,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new ModelProviderError(
        `OpenAI request failed (${response.status})`,
        'openai',
        response.status,
      );
    }

    const data = (await response.json()) as OpenAIResponse;
    if (data.error?.message) {
      throw new ModelProviderError(data.error.message, 'openai');
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new ModelProviderError('OpenAI returned an empty response', 'openai');
    }

    return { role: 'assistant', content };
  }
}

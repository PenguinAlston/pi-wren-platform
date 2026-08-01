import type { ChatMessage } from '@pi-wren/shared-types';
import { ModelProviderError, type ChatOptions, type ModelProvider } from '../model';

interface OllamaResponse {
  message?: { role?: string; content?: string };
  error?: string;
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  model?: string;
}

/** Local Ollama chat client (no API key required). */
export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama' as const;

  constructor(private readonly opts: OllamaProviderOptions) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatMessage> {
    const baseUrl = this.opts.baseUrl ?? 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.opts.model ?? 'qwen2.5:7b',
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: { temperature: options?.temperature ?? 0.2 },
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new ModelProviderError(
        `Ollama request failed (${response.status})`,
        'ollama',
        response.status,
      );
    }

    const data = (await response.json()) as OllamaResponse;
    if (data.error) {
      throw new ModelProviderError(data.error, 'ollama');
    }

    const content = data.message?.content;
    if (!content) {
      throw new ModelProviderError('Ollama returned an empty response', 'ollama');
    }

    return { role: 'assistant', content };
  }
}

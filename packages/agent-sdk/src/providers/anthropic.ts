import { ChatMessage, ModelProvider } from '../model';

export class AnthropicProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    return {
      role: 'assistant',
      content: `Anthropic provider placeholder for: ${messages.at(-1)?.content ?? ''}`,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatMessage> {
    yield await this.chat(messages);
  }
}

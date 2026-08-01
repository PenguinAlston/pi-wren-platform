import { ChatMessage, ModelProvider } from '../model';

export class OpenAIProvider implements ModelProvider {
  constructor(private apiKey: string) {}

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    // TODO: connect OpenAI SDK
    return {
      role: 'assistant',
      content: `OpenAI response placeholder for: ${messages.at(-1)?.content ?? ''}`,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatMessage> {
    yield await this.chat(messages);
  }
}

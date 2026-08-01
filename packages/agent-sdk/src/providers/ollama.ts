import { ChatMessage, ModelProvider } from '../model';

export class OllamaProvider implements ModelProvider {
  constructor(private endpoint = 'http://localhost:11434') {}

  async chat(messages: ChatMessage[]): Promise<ChatMessage> {
    return {
      role: 'assistant',
      content: `Local model placeholder: ${messages.at(-1)?.content ?? ''}`,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncIterable<ChatMessage> {
    yield await this.chat(messages);
  }
}

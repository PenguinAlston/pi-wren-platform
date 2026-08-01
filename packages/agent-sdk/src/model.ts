export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ModelProvider {
  chat(messages: ChatMessage[]): Promise<ChatMessage>;
  stream(messages: ChatMessage[]): AsyncIterable<ChatMessage>;
}

import { ModelProvider, ChatMessage } from '../../../packages/agent-sdk/src/model';
import { ToolRunner } from './tool-runner';

export class AgentRuntime {
  constructor(
    private model: ModelProvider,
    private tools = new ToolRunner(),
  ) {}

  async run(input: string) {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: input,
      },
    ];

    const response = await this.model.chat(messages);

    return {
      input,
      response,
      tools: this.tools.list(),
    };
  }
}

import { AgentRequest, AgentResponse } from './types';

export class AgentExecutor {
  async execute(request: AgentRequest): Promise<AgentResponse> {
    const events = [
      {
        type: 'started' as const,
        message: 'Agent execution started',
        timestamp: new Date().toISOString(),
      },
      {
        type: 'thinking' as const,
        message: 'Planning task execution',
        timestamp: new Date().toISOString(),
      },
    ];

    return {
      sessionId: request.sessionId,
      output: `Agent received: ${request.input}`,
      events,
    };
  }
}

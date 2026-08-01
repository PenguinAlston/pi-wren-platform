export interface AgentStreamEvent {
  type: 'plan' | 'tool' | 'answer';
  content: string;
}

export async function* createAgentStream(input: string) {
  const events: AgentStreamEvent[] = [
    {
      type: 'plan',
      content: `Planning: ${input}`,
    },
    {
      type: 'answer',
      content: 'Agent response stream initialized',
    },
  ];

  for (const event of events) {
    yield event;
  }
}

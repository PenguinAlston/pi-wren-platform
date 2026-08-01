export type AgentEventType =
  | 'plan'
  | 'tool_call'
  | 'observation'
  | 'answer';

export interface RuntimeEvent {
  type: AgentEventType;
  payload: unknown;
  createdAt: string;
}

export function createEvent(type: AgentEventType, payload: unknown): RuntimeEvent {
  return {
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
}

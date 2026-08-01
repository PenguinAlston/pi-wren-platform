export type AgentEventType =
  | 'started'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'completed'
  | 'failed';

export interface AgentEvent {
  type: AgentEventType;
  message: string;
  timestamp: string;
}

export interface AgentRequest {
  sessionId: string;
  input: string;
}

export interface AgentResponse {
  sessionId: string;
  output: string;
  events: AgentEvent[];
}

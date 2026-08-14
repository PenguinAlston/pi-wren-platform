/**
 * 前后端共享契约类型（后端不消费；与 backend/app/models/schemas.py 保持一致）。
 */

// --- Agent events & runs ---
export type AgentEventType =
  | 'plan'
  | 'tool_call'
  | 'tool_result'
  | 'observation'
  | 'answer'
  | 'error';

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  label: string;
  detail?: string;
  timestamp: string;
}

export interface AgentToolCall {
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  ok: boolean;
}

export interface AgentRunResult {
  sessionId: string;
  answer: string;
  sql?: string;
  data?: Record<string, unknown>[];
  trace: string[];
  events: AgentEvent[];
  toolCalls: AgentToolCall[];
  durationMs: number;
  error?: string;
}

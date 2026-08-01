/**
 * Shared cross-boundary types for the pi-wren platform.
 * These types are consumed by every workspace to keep contracts consistent.
 */

// --- Agents & tools ---
export interface Agent {
  id: string;
  name: string;
  description?: string;
  tools: Tool[];
}

export interface Tool {
  name: string;
  description: string;
  requiresApproval?: boolean;
}

export interface AgentTask {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: string;
  output?: string;
}

// --- Chat / model ---
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

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

// --- Data / context ---
export interface QueryResult {
  rows: Record<string, unknown>[];
  count: number | null;
}

export interface MetricDefinition {
  name: string;
  definition: string;
  value?: number;
  unit?: string;
}

export interface ContextResult {
  source: string;
  content: string;
  confidence?: number;
}

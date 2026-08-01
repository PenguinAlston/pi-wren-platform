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

export interface ContextResult {
  source: string;
  content: string;
  confidence?: number;
}

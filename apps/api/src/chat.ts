import { AgentRuntime } from '../../../services/agent-runtime/src/runtime';
import { ToolSelector } from '../../../services/agent-runtime/src/tool-selection';

const selector = new ToolSelector();

export async function chat(message: string) {
  const decision = selector.decide(message);

  const runtime = {
    message,
    tool: decision,
    answer: `正在分析: ${message}`,
  };

  return runtime;
}

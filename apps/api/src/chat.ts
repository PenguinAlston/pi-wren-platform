import { runFinanceAgent } from '../../../services/agent-runtime/src/finance-agent';

export async function chat(message: string) {
  return runFinanceAgent(message);
}

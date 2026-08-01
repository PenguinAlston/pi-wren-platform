import { AgentExecutor } from '../../../services/agent-runtime/src/executor';

const executor = new AgentExecutor();

export async function chat(input: string) {
  return executor.execute({
    sessionId: crypto.randomUUID(),
    input,
  });
}

// Future HTTP layer:
// POST /agent/chat
// GET /agent/events/:id

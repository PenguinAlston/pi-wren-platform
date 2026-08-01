import { WrenAIClient } from '../../../context-engine/src/wren/client';

export async function generateSQL(question: string) {
  const client = new WrenAIClient(
    process.env.WREN_URL || 'http://localhost:8000',
    process.env.WREN_TOKEN,
  );

  return client.generateSQL(question);
}

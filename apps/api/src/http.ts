import { chat } from './chat';

export async function handleAgentChat(body: { message: string }) {
  return chat(body.message);
}

export async function health() {
  return { status: 'ok', service: 'pi-wren-api' };
}

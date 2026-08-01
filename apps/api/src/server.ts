import { handleAgentChat, health } from './http';

export async function apiRequest(
  path: string,
  body?: { message: string },
) {
  if (path === '/health') {
    return health();
  }

  if (path === '/api/agent/chat' && body) {
    return handleAgentChat(body);
  }

  return {
    error: 'Not found',
  };
}

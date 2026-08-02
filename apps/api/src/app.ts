import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { ApiDeps } from './deps';
import { createAgentsHandler } from './routes/agents';
import {
  createAdminAgentHandler,
  deleteAdminAgentHandler,
  getAdminAgentHandler,
  listAdminAgentsHandler,
  requireAdminToken,
  testAgentConnectionHandler,
  testDbConnectionHandler,
  updateAdminAgentHandler,
  validateMdlHandler,
} from './routes/admin-agents';
import { createChatHandler } from './routes/chat';
import { createChatStreamHandler } from './routes/chat-stream';
import { createHealthHandler } from './routes/health';
import { createErrorHandler } from './middleware/error-handler';

/** Assemble the Express application with middleware and routes. */
export function createApp(deps: ApiDeps) {
  const app = express();

  app.disable('x-powered-by');
  app.use(pinoHttp({ logger: deps.logger }));
  app.use(cors({ origin: deps.config.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', createHealthHandler(deps.config));
  app.get('/api/health', createHealthHandler(deps.config));
  app.get('/api/agents', createAgentsHandler(deps));
  // 兼容默认财务 Agent
  app.post('/api/agent/chat', createChatHandler(deps, deps.logger));
  // 按领域路由：/api/agent/:domain/chat
  app.post('/api/agent/:domain/chat', createChatHandler(deps, deps.logger));
  // SSE 流式输出：执行事件实时推送（方案 A 事件协议）
  app.post('/api/agent/:domain/chat/stream', createChatStreamHandler(deps, deps.logger));

  // 自定义 Agent 管理面（X-Admin-Token）
  const adminAuth = requireAdminToken(deps);
  app.get('/api/admin/agents', adminAuth, listAdminAgentsHandler(deps));
  app.post('/api/admin/agents', adminAuth, createAdminAgentHandler(deps));
  app.get('/api/admin/agents/:agentId', adminAuth, getAdminAgentHandler(deps));
  app.put('/api/admin/agents/:agentId', adminAuth, updateAdminAgentHandler(deps));
  app.delete('/api/admin/agents/:agentId', adminAuth, deleteAdminAgentHandler(deps));
  app.post('/api/admin/agents/test', adminAuth, testDbConnectionHandler(deps));
  app.post('/api/admin/agents/:agentId/test', adminAuth, testAgentConnectionHandler(deps));
  app.post('/api/admin/agents/validate', adminAuth, validateMdlHandler(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(createErrorHandler(deps.logger));

  return app;
}

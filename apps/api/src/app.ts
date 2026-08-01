import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { ApiDeps } from './deps';
import { createChatHandler } from './routes/chat';
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
  app.post('/api/agent/chat', createChatHandler(deps.agent, deps.logger));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(createErrorHandler(deps.logger));

  return app;
}

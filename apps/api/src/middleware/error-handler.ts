import type { ErrorRequestHandler } from 'express';
import type { Logger } from '../logger';

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    logger.error({ err: error, path: req.path, method: req.method }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  };
}

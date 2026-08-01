import type { Request, Response } from 'express';
import type { ApiConfig } from '../config';

export function createHealthHandler(config: ApiConfig) {
  return (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'pi-wren-api',
      version: '0.2.0',
      time: new Date().toISOString(),
      provider: config.LLM_PROVIDER,
    });
  };
}

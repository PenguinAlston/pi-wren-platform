import { z } from 'zod';
import type { Request, Response } from 'express';
import type { FinanceAgent } from '@pi-wren/agent-runtime';
import type { Logger } from '../logger';

const chatRequestSchema = z.object({
  message: z.string().trim().min(1, 'message is required').max(4000, 'message too long'),
});

export function createChatHandler(agent: FinanceAgent, logger: Logger) {
  return async (req: Request, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid request',
        details: parsed.error.flatten(),
      });
      return;
    }

    const result = await agent.answer(parsed.data.message);

    logger.info(
      { sessionId: result.sessionId, durationMs: result.durationMs, error: result.error },
      'chat completed',
    );

    res.json(result);
  };
}

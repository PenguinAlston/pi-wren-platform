import { z } from 'zod';
import type { Request, Response } from 'express';
import type { ApiDeps } from '../deps';
import type { Logger } from '../logger';

const chatRequestSchema = z.object({
  message: z.string().trim().min(1, 'message is required').max(4000, 'message too long'),
  sessionId: z.string().trim().min(1).max(128).optional(),
});

export function createChatHandler(deps: ApiDeps, logger: Logger) {
  return async (req: Request, res: Response) => {
    const domain = (req.params.domain ?? 'finance') as string;
    const spec = deps.agents.find((agent) => agent.id === domain);

    if (!spec) {
      res.status(404).json({ error: `unknown agent: ${domain}` });
      return;
    }

    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }

    const result = await spec.agent.answer(parsed.data.message, {
      sessionId: parsed.data.sessionId,
    });

    logger.info(
      {
        domain,
        sessionId: result.sessionId,
        durationMs: result.durationMs,
        error: result.error,
      },
      'chat completed',
    );

    res.json(result);
  };
}

import { z } from 'zod';
import type { Request, Response } from 'express';
import { formatSseComment, formatSseDone, formatSseEvent, SSE_HEADERS } from '@pi-wren/pi-bridge';
import type { ApiDeps } from '../deps';
import type { Logger } from '../logger';

const streamRequestSchema = z.object({
  message: z.string().trim().min(1, 'message is required').max(4000, 'message too long'),
  sessionId: z.string().trim().min(1).max(128).optional(),
});

/**
 * SSE 流式问答端点：POST /api/agent/:domain/chat/stream
 * 执行事件（plan/tool_call/tool_result/observation/answer/error）逐个推送，
 * 结束帧 event: done 携带完整运行结果。
 */
export function createChatStreamHandler(deps: ApiDeps, logger: Logger) {
  return async (req: Request, res: Response) => {
    const domain = (req.params.domain ?? 'finance') as string;
    const spec =
      deps.customAgents?.get(domain) ?? deps.agents.find((agent) => agent.id === domain);

    if (!spec) {
      res.status(404).json({ error: `unknown agent: ${domain}` });
      return;
    }

    const parsed = streamRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }

    const { message, sessionId } = parsed.data;

    res.writeHead(200, SSE_HEADERS);
    // 心跳：防止长链路（Next 代理等）空闲超时断开
    const heartbeat = setInterval(() => res.write(formatSseComment()), 15_000);
    req.on('close', () => clearInterval(heartbeat));

    const result = await spec.agent.answer(message, {
      sessionId,
      onEvent: (event) => res.write(formatSseEvent(event)),
    });

    clearInterval(heartbeat);
    res.write(formatSseDone(result));
    res.end();

    logger.info(
      {
        domain,
        sessionId: result.sessionId,
        durationMs: result.durationMs,
        error: result.error,
      },
      'chat stream completed',
    );
  };
}

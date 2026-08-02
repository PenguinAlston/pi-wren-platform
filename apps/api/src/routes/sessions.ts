import { Router } from 'express';
import { z } from 'zod';
import type { PiSessionStore } from '@pi-wren/pi-bridge';

const sessionIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'sessionId 只允许字母/数字/下划线/连字符');

const renameSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(128, 'name too long'),
});

/**
 * AI 会话管理接口（需求 4.2/4.3.3）：列表、回看、重命名、删除。
 * 会话数据来自开源 Pi jsonl 会话仓库（data/sessions）。
 */
export function createSessionsRouter(sessions: PiSessionStore): Router {
  const router = Router();

  // GET /api/sessions?search=关键词 —— 左侧会话栏（支持搜索）
  router.get('/', async (req, res) => {
    const search =
      typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const all = await sessions.listSessions();
    const list = search ? all.filter((s) => s.name.toLowerCase().includes(search)) : all;
    res.json({ sessions: list });
  });

  // GET /api/sessions/:sessionId —— 回看历史消息
  router.get('/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId ?? '';
    if (!sessionIdSchema.safeParse(sessionId).success) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    const session = await sessions.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json({ sessionId, name: session.name, messages: session.records });
  });

  // PUT /api/sessions/:sessionId —— 重命名
  router.put('/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId ?? '';
    if (!sessionIdSchema.safeParse(sessionId).success) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    try {
      await sessions.renameSession(sessionId, parsed.data.name);
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : 'rename failed' });
      return;
    }
    res.json({ sessionId, name: parsed.data.name });
  });

  // DELETE /api/sessions/:sessionId —— 删除
  router.delete('/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId ?? '';
    if (!sessionIdSchema.safeParse(sessionId).success) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    const deleted = await sessions.deleteSession(sessionId);
    if (!deleted) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.status(204).end();
  });

  return router;
}

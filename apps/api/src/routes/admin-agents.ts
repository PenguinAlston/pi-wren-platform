import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import type { AgentRegistry } from '@pi-wren/agent-registry';
import { createPool, type DatabaseConfig } from '@pi-wren/data-engine';
import { parseSemanticConfig } from '@pi-wren/context-engine';
import type { AgentSpec, ApiDeps } from '../deps';

const dbSchema = z.object({
  host: z.string().min(1).default('localhost'),
  port: z.number().int().positive().max(65535).optional(),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  max: z.number().int().positive().max(10).optional(),
});

const createAgentSchema = z.object({
  agentId: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,64}$/, 'agentId 只允许小写字母/数字/连字符'),
  name: z.string().trim().min(1).max(128),
  label: z.string().trim().min(1).max(128),
  description: z.string().trim().max(2000).optional(),
  systemPrompt: z.string().trim().max(8000).optional(),
  mdl: z.string().trim().min(10, 'MDL 内容过短').max(262_144, 'MDL 超过 256KB'),
  db: dbSchema,
});

const updateAgentSchema = createAgentSchema.partial().omit({ agentId: true });

const validateMdlSchema = z.object({ mdl: z.string().trim().min(10).max(262_144) });

/** 把用户提交的连接配置归一化为 DatabaseConfig（补默认 host/port）。 */
function normalizeDb(db: z.infer<typeof dbSchema>): DatabaseConfig {
  return {
    host: db.host ?? 'localhost',
    port: db.port ?? 5432,
    database: db.database,
    user: db.user,
    password: db.password,
    ...(db.max !== undefined ? { max: db.max } : {}),
  };
}

/** 管理面认证：X-Admin-Token 与环境变量 ADMIN_TOKEN 比对。 */
export function requireAdminToken(deps: ApiDeps) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = deps.config.ADMIN_TOKEN;
    if (!token) {
      res.status(503).json({ error: 'admin api disabled: ADMIN_TOKEN not configured' });
      return;
    }
    if (req.header('x-admin-token') !== token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

/** 未开启自定义 Agent（缺 AGENT_SECRET_KEY）时返回 503。 */
function ensureRegistry(deps: ApiDeps, res: Response): AgentRegistry<AgentSpec> | null {
  if (!deps.customAgents) {
    res.status(503).json({ error: 'custom agents disabled: AGENT_SECRET_KEY not configured' });
    return null;
  }
  return deps.customAgents;
}

function toPublicView(record: Awaited<ReturnType<AgentRegistry<AgentSpec>['getRecord']>>, includeMdl: boolean) {
  if (!record) return undefined;
  return {
    id: record.id,
    agentId: record.agentId,
    name: record.name,
    label: record.label,
    description: record.description,
    systemPrompt: record.systemPrompt,
    mdl: includeMdl ? record.mdl : undefined,
    connection: record.connectionMask,
    status: record.status,
    lastError: record.lastError,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createAdminAgentHandler(deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;

    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    const { agentId, db, ...config } = parsed.data;
    try {
      const instance = await registry.register({ agentId, ...config, db: normalizeDb(db) });
      res.status(201).json({
        agent: {
          id: instance.id,
          label: instance.label,
          description: instance.description,
          source: 'custom',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  };
}

export function listAdminAgentsHandler(deps: ApiDeps) {
  return async (_req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const records = await registry.getRecords();
    res.json({ agents: records.map((r) => toPublicView(r, false)) });
  };
}

export function getAdminAgentHandler(deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const record = await registry.getRecord(req.params.agentId as string);
    if (!record) {
      res.status(404).json({ error: `agent not found: ${req.params.agentId}` });
      return;
    }
    res.json({ agent: toPublicView(record, true) });
  };
}

export function updateAdminAgentHandler(deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    const { db, ...patch } = parsed.data;
    try {
      const instance = await registry.update(req.params.agentId as string, {
        ...patch,
        ...(db ? { db: normalizeDb(db) } : {}),
      });
      if (!instance) {
        res.status(404).json({ error: `agent not found: ${req.params.agentId}` });
        return;
      }
      res.json({ agent: { id: instance.id, label: instance.label, source: 'custom' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  };
}

export function deleteAdminAgentHandler(deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const deleted = await registry.unregister(req.params.agentId as string);
    if (!deleted) {
      res.status(404).json({ error: `agent not found: ${req.params.agentId}` });
      return;
    }
    res.status(204).end();
  };
}

/** 执行 SELECT 1 连通性测试，共用实现。 */
async function probeConnection(db: z.infer<typeof dbSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const pool = createPool({
    ...db,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMillis: 5_000,
  });
  try {
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `connection failed: ${message}` };
  } finally {
    await pool.end();
  }
}

/** 测试任意连接配置：POST /api/admin/agents/test。 */
export function testDbConnectionHandler(_deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const parsed = z.object({ db: dbSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid connection config', details: parsed.error.flatten() });
      return;
    }
    const result = await probeConnection(normalizeDb(parsed.data.db));
    res.status(result.ok ? 200 : 400).json(result);
  };
}

/** 测试已注册 Agent 的连接：POST /api/admin/agents/:agentId/test。 */
export function testAgentConnectionHandler(deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const config = await registry.getDbConfig(req.params.agentId as string);
    if (!config) {
      res.status(404).json({ error: `agent not found: ${req.params.agentId}` });
      return;
    }
    const result = await probeConnection(config);
    res.status(result.ok ? 200 : 400).json(result);
  };
}

/** 仅校验 MDL（不落库、不建实例），供前端实时校验。 */
export function validateMdlHandler(_deps: ApiDeps) {
  return (req: Request, res: Response) => {
    const parsed = validateMdlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    try {
      const config = parseSemanticConfig(parsed.data.mdl);
      res.json({
        ok: true,
        models: config.models.map((m) => m.table),
        intents: config.intents.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: `MDL 校验失败：${message}` });
    }
  };
}

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
  ownerId: z.string().trim().max(64).optional(),
});

const updateAgentSchema = createAgentSchema
  .partial()
  .omit({ agentId: true })
  .extend({ status: z.enum(['enabled', 'disabled']).optional() });

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
      const instance = await registry.register({
        agentId,
        ...config,
        db: normalizeDb(db),
        ownerId: parsed.data.ownerId,
      });
      await deps.audit?.log({
        operType: 'agent_register',
        operContent: `注册自定义 Agent：${agentId}（${config.label}）`,
        sqlContent: `mdl=${parsed.data.mdl.length} chars`,
        ipAddress: req.ip,
      });
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
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const ownerId = typeof req.query.ownerId === 'string' ? req.query.ownerId : undefined;
    const records = await registry.getRecords();
    const filtered = ownerId ? records.filter((r) => r.ownerId === ownerId) : records;
    res.json({ agents: filtered.map((r) => toPublicView(r, false)) });
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
    const agentId = req.params.agentId as string;
    try {
      const before = await registry.getRecord(agentId);
      const instance = await registry.update(agentId, {
        ...patch,
        ...(db ? { db: normalizeDb(db) } : {}),
      });
      if (!instance) {
        res.status(404).json({ error: `agent not found: ${agentId}` });
        return;
      }
      const operType =
        before && patch.status && patch.status !== before.status ? 'agent_status' : 'agent_update';
      await deps.audit?.log({
        operType,
        operContent: `${operType === 'agent_status' ? '变更状态' : '更新配置'}：${agentId}（${instance.label}）`,
        sqlContent: patch.mdl ? `mdl=${patch.mdl.length} chars` : undefined,
        ipAddress: req.ip,
      });
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
    const agentId = req.params.agentId as string;
    const before = await registry.getRecord(agentId);
    const deleted = await registry.unregister(agentId);
    if (!deleted) {
      res.status(404).json({ error: `agent not found: ${agentId}` });
      return;
    }
    await deps.audit?.log({
      operType: 'agent_delete',
      operContent: `注销自定义 Agent：${agentId}（${before?.name ?? 'unknown'}）`,
      ipAddress: req.ip,
    });
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

/** Agent 运行状态：配置状态 + 连接池统计（监控）。 */
export function agentStatusHandler(deps: ApiDeps) {
  return async (req: Request, res: Response) => {
    const registry = ensureRegistry(deps, res);
    if (!registry) return;
    const agentId = req.params.agentId as string;
    const record = await registry.getRecord(agentId);
    if (!record) {
      res.status(404).json({ error: `agent not found: ${agentId}` });
      return;
    }
    res.json({
      agentId,
      status: record.status,
      lastError: record.lastError,
      active: registry.get(agentId) !== undefined,
      pool: deps.poolManager?.stats(agentId) ?? null,
    });
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

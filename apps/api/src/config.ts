import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnvFile } from 'dotenv';

// 加载 .env：优先进程 cwd，其次仓库根（apps/api 运行时 -> ../../.env）
for (const candidate of [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    loadEnvFile({ path: candidate });
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default('piwren'),
  DB_USER: z.string().default('demo'),
  DB_PASSWORD: z.string().default('demo'),

  LLM_PROVIDER: z.enum(['mock', 'openai', 'anthropic', 'ollama']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  OLLAMA_MODEL: z.string().optional(),

  WREN_URL: z.string().optional(),
  WREN_TOKEN: z.string().optional(),
  SEMANTIC_DIR: z.string().optional(),

  // 会话持久化目录（开源 Pi jsonl 存储），默认 <cwd>/data/sessions
  SESSION_DIR: z.string().optional(),

  // 自定义 Agent 管理面：ADMIN_TOKEN（X-Admin-Token 比对）+ 连接串加密密钥（≥32 字节）
  ADMIN_TOKEN: z.string().optional(),
  AGENT_SECRET_KEY: z.string().min(8, 'AGENT_SECRET_KEY 至少 8 字符，建议 ≥32 字节').optional(),
  // 管理操作审计主体（sys_user.user_id），默认 UADMIN（z_admin_seed.sql 提供）
  AUDIT_USER_ID: z.string().default('UADMIN'),
});

export type ApiConfig = z.infer<typeof envSchema>;

/** Validate and normalize environment configuration at startup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return envSchema.parse(env);
}

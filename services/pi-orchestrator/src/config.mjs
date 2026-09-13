import { fileURLToPath } from 'node:url';

/** env → 配置对象（缺必填项直接抛错，fail-fast）。 */
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PI_PORT ?? 8090),
    // 容器部署需 0.0.0.0（backend 经容器网络访问）；本地开发建议 127.0.0.1
    bindHost: env.PI_BIND_HOST ?? '0.0.0.0',
    internalToken: env.INTERNAL_API_TOKEN ?? '',
    backendUrl: env.PY_BACKEND_URL ?? 'http://127.0.0.1:8080',
    dataDir: env.PI_DATA_DIR ?? fileURLToPath(new URL('../data/sessions', import.meta.url)),
    openaiBaseUrl: env.OPENAI_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? 'qwen3.7-flash',
    maxToolCalls: Number(env.PI_MAX_TOOL_CALLS ?? 8),
    maxDurationMs: Number(env.PI_MAX_DURATION_MS ?? 175_000),
    toolTimeoutMs: Number(env.PI_TOOL_TIMEOUT_MS ?? 120_000),
    historyTurns: 3,
    // 会话存储后端：jsonl（本地开发默认）| pg（生产，多副本共享）
    sessionBackend: env.PI_SESSION_BACKEND ?? 'jsonl',
    db: {
      host: env.DB_HOST ?? 'postgres',
      port: Number(env.DB_PORT ?? 5432),
      user: env.DB_USER ?? 'demo',
      password: env.DB_PASSWORD ?? 'demo',
      database: env.DB_NAME ?? 'piwren',
    },
  };
  if (!config.internalToken) throw new Error('INTERNAL_API_TOKEN is required');
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
  return config;
}

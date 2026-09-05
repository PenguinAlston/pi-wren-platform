import { fileURLToPath } from 'node:url';

/** env → 配置对象（缺必填项直接抛错，fail-fast）。 */
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PI_PORT ?? 8090),
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
  };
  if (!config.internalToken) throw new Error('INTERNAL_API_TOKEN is required');
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
  return config;
}

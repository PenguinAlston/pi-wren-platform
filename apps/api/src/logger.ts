import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(config: { LOG_LEVEL: string; NODE_ENV?: string }): Logger {
  return pino({
    level: config.LOG_LEVEL,
    // 请求头（含 x-admin-token 等敏感凭据）不进日志
    redact: { paths: ['req.headers'], censor: '[Redacted]' },
    ...(config.NODE_ENV === 'production' ? { transport: undefined } : {}),
  });
}

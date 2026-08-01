import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(config: { LOG_LEVEL: string; NODE_ENV?: string }): Logger {
  return pino({
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'production' ? { transport: undefined } : {}),
  });
}

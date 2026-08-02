import pg from 'pg';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  connectionTimeoutMillis?: number;
  /** 单条语句超时（ms），pg statement_timeout；不设置则无超时。 */
  statementTimeoutMillis?: number;
}

/** Build a pg Pool from an explicit config (or process env by default). */
export function createPool(config: Partial<DatabaseConfig> = {}) {
  const resolved: DatabaseConfig = {
    host: config.host ?? process.env.DB_HOST ?? 'localhost',
    port: config.port ?? Number(process.env.DB_PORT ?? 5432),
    database: config.database ?? process.env.DB_NAME ?? 'piwren',
    user: config.user ?? process.env.DB_USER ?? 'demo',
    password: config.password ?? process.env.DB_PASSWORD ?? 'demo',
    max: config.max ?? 10,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
    ...(config.statementTimeoutMillis !== undefined ? { statement_timeout: config.statementTimeoutMillis } : {}),
  };

  return new pg.Pool(resolved);
}

/** Shared pool used by default across the platform. */
export const pool = createPool();

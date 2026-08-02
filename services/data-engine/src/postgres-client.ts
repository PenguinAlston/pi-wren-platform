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
  /** 只读连接：设置 default_transaction_read_only=on，数据库层禁止任何写操作。 */
  readOnly?: boolean;
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
    ...buildPoolOptions(config),
  };

  return new pg.Pool(resolved);
}

/** 拼装 pg 连接参数（只读事务 + 语句超时），通过 -c 选项下发。 */
function buildPoolOptions(config: Partial<DatabaseConfig>): { options?: string } {
  const options: string[] = [];
  if (config.readOnly) {
    options.push('-c default_transaction_read_only=on');
  }
  if (config.statementTimeoutMillis !== undefined) {
    options.push(`-c statement_timeout=${config.statementTimeoutMillis}`);
  }
  return options.length > 0 ? { options: options.join(' ') } : {};
}

/** Shared pool used by default across the platform. */
export const pool = createPool();

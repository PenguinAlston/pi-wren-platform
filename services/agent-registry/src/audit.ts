import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export interface AuditEntry {
  /** 操作类型：agent_register / agent_update / agent_delete / agent_status 等。 */
  operType: string;
  /** 操作内容描述。 */
  operContent: string;
  /** 附加内容（如 MDL 摘要/长度）。 */
  sqlContent?: string;
  ipAddress?: string;
  /** 审计主体（sys_user.user_id）；缺省用平台管理用户。 */
  userId?: string;
}

/** 操作审计抽象（sys_operation_log）。 */
export interface OperationAuditLogger {
  log(entry: AuditEntry): Promise<void>;
}

/** 空实现：未配置审计时静默跳过。 */
export class NoopAuditLogger implements OperationAuditLogger {
  async log(_entry: AuditEntry): Promise<void> {
    // no-op
  }
}

/**
 * PostgreSQL 审计：写入 sys_operation_log。
 * 审计失败不阻断业务（内部捕获并吞掉）。
 */
export class PostgresOperationAuditLogger implements OperationAuditLogger {
  constructor(
    private readonly pool: Pool,
    private readonly defaultUserId = 'UADMIN',
  ) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO sys_operation_log (log_id, user_id, oper_type, oper_content, sql_content, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          entry.userId ?? this.defaultUserId,
          entry.operType,
          entry.operContent,
          entry.sqlContent ?? null,
          entry.ipAddress ?? null,
        ],
      );
    } catch {
      // 审计失败不阻断业务操作
    }
  }
}

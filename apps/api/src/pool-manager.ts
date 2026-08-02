import type { Pool } from 'pg';
import { createPool, type DatabaseConfig } from '@pi-wren/data-engine';

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

/**
 * 自定义 Agent 连接池管理器：按 agentId 维护独立 pg Pool，
 * 提供连接数统计（监控）与释放（更新/注销时调用）。
 */
export class AgentPoolManager {
  private readonly pools = new Map<string, Pool>();

  /** 创建（或复用）某 Agent 的连接池。 */
  create(agentId: string, db: DatabaseConfig): Pool {
    const existing = this.pools.get(agentId);
    if (existing) {
      return existing;
    }
    const pool = createPool({
      ...db,
      max: db.max ?? 3,
      connectionTimeoutMillis: 5_000,
      statementTimeoutMillis: 15_000,
      readOnly: true, // 数据库层强制只读，即使校验器被绕过也无法写数据
    });
    this.pools.set(agentId, pool);
    return pool;
  }

  /** 连接池统计（监控用）；未知 Agent 返回 undefined。 */
  stats(agentId: string): PoolStats | undefined {
    const pool = this.pools.get(agentId);
    if (!pool) return undefined;
    return {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  }

  /** 释放并移除某 Agent 的连接池。 */
  async dispose(agentId: string): Promise<void> {
    const pool = this.pools.get(agentId);
    if (pool) {
      this.pools.delete(agentId);
      await pool.end().catch(() => undefined);
    }
  }
}

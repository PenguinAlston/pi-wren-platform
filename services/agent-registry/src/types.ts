import type { DatabaseConfig } from '@pi-wren/data-engine';

/** 用户提交的自定义 Agent 配置（API 层解密后的形态）。 */
export interface CustomAgentConfig {
  agentId: string;
  name: string;
  label: string;
  description?: string;
  systemPrompt?: string;
  /** MDL YAML 原文。 */
  mdl: string;
  /** 数据库连接配置。 */
  db: DatabaseConfig;
  status: 'enabled' | 'disabled';
}

/** sys_agent_config 表中的一行（db_connection_enc 为密文）。 */
export interface AgentConfigRecord {
  id: string;
  agentId: string;
  name: string;
  label: string;
  description: string | null;
  systemPrompt: string | null;
  mdl: string;
  dbConnectionEnc: string;
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 连接信息脱敏展示：`***@host:port/database`。 */
export function maskConnection(db: DatabaseConfig): string {
  const host = db.host ?? 'localhost';
  const port = db.port ?? 5432;
  const database = db.database ?? '';
  return `***@${host}:${port}/${database}`;
}

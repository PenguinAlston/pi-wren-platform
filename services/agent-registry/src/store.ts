import type { Pool } from 'pg';
import type { AgentConfigRecord } from './types';

/** sys_agent_config 数据访问抽象（生产=Postgres，测试=内存）。 */
export interface AgentConfigStore {
  list(): Promise<AgentConfigRecord[]>;
  findByAgentId(agentId: string): Promise<AgentConfigRecord | undefined>;
  create(record: Omit<AgentConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentConfigRecord>;
  update(agentId: string, patch: Partial<AgentConfigRecord>): Promise<AgentConfigRecord | undefined>;
  delete(agentId: string): Promise<boolean>;
}

interface AgentConfigRow {
  id: string;
  agent_id: string;
  name: string;
  label: string;
  description: string | null;
  system_prompt: string | null;
  mdl: string;
  db_connection_enc: string;
  status: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: AgentConfigRow): AgentConfigRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    label: row.label,
    description: row.description,
    systemPrompt: row.system_prompt,
    mdl: row.mdl,
    dbConnectionEnc: row.db_connection_enc,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, agent_id, name, label, description, system_prompt, mdl,
  db_connection_enc, status, last_error, created_at, updated_at
`;

/** PostgreSQL 实现：读写 sys_agent_config 表。 */
export class PostgresAgentConfigStore implements AgentConfigStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<AgentConfigRecord[]> {
    const result = await this.pool.query<AgentConfigRow>(
      `SELECT ${SELECT_COLUMNS} FROM sys_agent_config ORDER BY created_at ASC`,
    );
    return result.rows.map(rowToRecord);
  }

  async findByAgentId(agentId: string): Promise<AgentConfigRecord | undefined> {
    const result = await this.pool.query<AgentConfigRow>(
      `SELECT ${SELECT_COLUMNS} FROM sys_agent_config WHERE agent_id = $1`,
      [agentId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : undefined;
  }

  async create(record: Omit<AgentConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentConfigRecord> {
    const result = await this.pool.query<AgentConfigRow>(
      `INSERT INTO sys_agent_config
        (agent_id, name, label, description, system_prompt, mdl, db_connection_enc, status, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${SELECT_COLUMNS}`,
      [
        record.agentId,
        record.name,
        record.label,
        record.description,
        record.systemPrompt,
        record.mdl,
        record.dbConnectionEnc,
        record.status,
        record.lastError,
      ],
    );
    return rowToRecord(result.rows[0]!);
  }

  async update(agentId: string, patch: Partial<AgentConfigRecord>): Promise<AgentConfigRecord | undefined> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const fieldMap: Record<string, string> = {
      name: 'name',
      label: 'label',
      description: 'description',
      systemPrompt: 'system_prompt',
      mdl: 'mdl',
      dbConnectionEnc: 'db_connection_enc',
      status: 'status',
      lastError: 'last_error',
    };
    for (const [key, column] of Object.entries(fieldMap)) {
      if (patch[key as keyof AgentConfigRecord] !== undefined) {
        values.push(patch[key as keyof AgentConfigRecord]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length === 0) {
      return this.findByAgentId(agentId);
    }
    values.push(agentId);
    const result = await this.pool.query<AgentConfigRow>(
      `UPDATE sys_agent_config SET ${sets.join(', ')}, updated_at = now()
       WHERE agent_id = $${values.length}
       RETURNING ${SELECT_COLUMNS}`,
      values,
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : undefined;
  }

  async delete(agentId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM sys_agent_config WHERE agent_id = $1',
      [agentId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

/** 内存实现（测试/演示用）。 */
export class InMemoryAgentConfigStore implements AgentConfigStore {
  private readonly records = new Map<string, AgentConfigRecord>();
  private seq = 0;

  async list(): Promise<AgentConfigRecord[]> {
    return [...this.records.values()];
  }

  async findByAgentId(agentId: string): Promise<AgentConfigRecord | undefined> {
    return this.records.get(agentId);
  }

  async create(record: Omit<AgentConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentConfigRecord> {
    const now = new Date().toISOString();
    const full: AgentConfigRecord = {
      ...record,
      id: `mem-${++this.seq}`,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.agentId, full);
    return full;
  }

  async update(agentId: string, patch: Partial<AgentConfigRecord>): Promise<AgentConfigRecord | undefined> {
    const current = this.records.get(agentId);
    if (!current) return undefined;
    const updated: AgentConfigRecord = { ...current, ...patch, agentId, updatedAt: new Date().toISOString() };
    this.records.set(agentId, updated);
    return updated;
  }

  async delete(agentId: string): Promise<boolean> {
    return this.records.delete(agentId);
  }
}

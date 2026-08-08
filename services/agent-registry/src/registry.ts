import type { DatabaseConfig } from '@pi-wren/data-engine';
import { decryptSecret, encryptSecret } from './crypto';
import type { AgentConfigStore } from './store';
import { maskConnection, type AgentConfigRecord, type CustomAgentConfig } from './types';

/** 由调用方注入的实例构建器：config → 可对外服务的 Agent 实例。 */
export interface CustomAgentFactory<T> {
  build(config: CustomAgentConfig): Promise<T>;
}

export interface AgentRegistryOptions<T> {
  store: AgentConfigStore;
  factory: CustomAgentFactory<T>;
  /** AES-256-GCM 密钥材料，用于加解密数据库连接串。 */
  secretKey: string;
  /** 实例销毁钩子（注销/更新替换时调用），用于释放连接池等资源。 */
  onDispose?: (agentId: string) => Promise<void> | void;
}

export interface LoadResult {
  loaded: number;
  failed: Array<{ agentId: string; error: string }>;
}

/**
 * 自定义 Agent 运行时注册表：管理实例生命周期（加载/注册/更新/停用/注销），
 * 连接串加密落库、单 Agent 失败隔离。
 */
export class AgentRegistry<T extends { id: string }> {
  private readonly agents = new Map<string, T>();

  constructor(private readonly opts: AgentRegistryOptions<T>) {}

  /** 启动时加载全部 enabled 配置；单个构建失败仅记录 lastError，不影响其他 Agent。 */
  async loadAll(): Promise<LoadResult> {
    const records = await this.opts.store.list();
    const failed: Array<{ agentId: string; error: string }> = [];
    for (const record of records) {
      if (record.status !== 'enabled') continue;
      try {
        const instance = await this.buildFromRecord(record);
        this.agents.set(record.agentId, instance);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ agentId: record.agentId, error: message });
        await this.opts.store.update(record.agentId, { status: 'error', lastError: message });
      }
    }
    return { loaded: this.agents.size, failed };
  }

  /** 注册新 Agent：构建成功才落库并生效（构建失败不写入）。 */
  async register(config: Omit<CustomAgentConfig, 'status'>): Promise<T> {
    if (this.agents.has(config.agentId)) {
      throw new Error(`agent already exists: ${config.agentId}`);
    }
    const full: CustomAgentConfig = { ...config, status: 'enabled' };
    const instance = await this.opts.factory.build(full); // 失败则抛错，不落库
    try {
      await this.opts.store.create(this.toRecord(full));
    } catch (error) {
      // 落库失败：释放已构建实例的资源（连接池），避免泄漏
      await this.opts.onDispose?.(config.agentId);
      throw error;
    }
    this.agents.set(config.agentId, instance);
    return instance;
  }

  /** 更新配置：新配置构建成功后才替换实例，失败保留旧实例；停用/无配置变更时不重建。 */
  async update(agentId: string, patch: Partial<Omit<CustomAgentConfig, 'agentId'>>): Promise<T | undefined> {
    const record = await this.opts.store.findByAgentId(agentId);
    if (!record) return undefined;
    const current = this.fromRecord(record);
    const merged: CustomAgentConfig = {
      ...current,
      ...patch,
      agentId,
      db: patch.db ?? current.db,
      status: patch.status ?? current.status,
    };
    const hasConfigChange =
      patch.projectJson !== undefined ||
      patch.db !== undefined ||
      patch.name !== undefined ||
      patch.label !== undefined ||
      patch.description !== undefined ||
      patch.systemPrompt !== undefined;

    if (merged.status === 'disabled' || !hasConfigChange) {
      // 停用（即使 MDL 已坏也能停用）或状态未变：不重建实例
      await this.opts.store.update(agentId, {
        ...(patch.name !== undefined ? { name: merged.name } : {}),
        ...(patch.label !== undefined ? { label: merged.label } : {}),
        ...(patch.description !== undefined ? { description: merged.description ?? null } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: merged.systemPrompt ?? null } : {}),
        ...(patch.projectJson !== undefined ? { projectJson: merged.projectJson } : {}),
        ...(patch.db !== undefined ? { dbConnectionEnc: this.encryptDb(merged.db) } : {}),
        status: merged.status,
        lastError: null,
        ...(patch.ownerId !== undefined ? { ownerId: merged.ownerId ?? null } : {}),
      });
      if (merged.status === 'disabled') {
        this.agents.delete(agentId);
        await this.opts.onDispose?.(agentId);
        return undefined;
      }
      return this.agents.get(agentId);
    }

    // 有配置变更且目标为 enabled：先构建成功再替换
    const instance = await this.opts.factory.build(merged); // 失败抛错，旧实例不受影响
    await this.opts.store.update(agentId, {
      name: merged.name,
      label: merged.label,
      description: merged.description ?? null,
      systemPrompt: merged.systemPrompt ?? null,
      projectJson: merged.projectJson,
      dbConnectionEnc: this.encryptDb(merged.db),
      status: merged.status,
      lastError: null,
      ownerId: merged.ownerId ?? null,
    });
    const previous = this.agents.get(agentId);
    this.agents.set(agentId, instance);
    if (previous && previous !== instance) {
      await this.opts.onDispose?.(agentId);
    }
    return instance;
  }

  /** 取已存 Agent 的解密连接配置（管理 API 连接测试用，不回传明文）。 */
  async getDbConfig(agentId: string): Promise<DatabaseConfig | undefined> {
    const record = await this.opts.store.findByAgentId(agentId);
    return record ? this.decryptDb(record.dbConnectionEnc) : undefined;
  }

  /** 启用/停用（不删除配置）。 */
  async setStatus(agentId: string, status: 'enabled' | 'disabled'): Promise<T | undefined> {
    return this.update(agentId, { status });
  }

  /** 注销：移除实例、释放资源并删除配置。 */
  async unregister(agentId: string): Promise<boolean> {
    this.agents.delete(agentId);
    await this.opts.onDispose?.(agentId);
    return this.opts.store.delete(agentId);
  }

  list(): T[] {
    return [...this.agents.values()];
  }

  /** 全部配置记录（连接信息脱敏），供管理 API 展示。 */
  async getRecords(): Promise<Array<AgentConfigRecord & { connectionMask: string }>> {
    const records = await this.opts.store.list();
    return records.map((record) => ({
      ...record,
      connectionMask: maskConnection(this.decryptDb(record.dbConnectionEnc)),
    }));
  }

  /** 单条配置记录（脱敏），供管理 API 展示。 */
  async getRecord(agentId: string): Promise<(AgentConfigRecord & { connectionMask: string }) | undefined> {
    const record = await this.opts.store.findByAgentId(agentId);
    return record ? { ...record, connectionMask: maskConnection(this.decryptDb(record.dbConnectionEnc)) } : undefined;
  }

  get(agentId: string): T | undefined {
    return this.agents.get(agentId);
  }

  private async buildFromRecord(record: AgentConfigRecord): Promise<T> {
    return this.opts.factory.build(this.fromRecord(record));
  }

  private fromRecord(record: AgentConfigRecord): CustomAgentConfig {
    return {
      agentId: record.agentId,
      name: record.name,
      label: record.label,
      description: record.description ?? undefined,
      systemPrompt: record.systemPrompt ?? undefined,
      projectJson: record.projectJson,
      db: this.decryptDb(record.dbConnectionEnc),
      status: record.status === 'disabled' ? 'disabled' : 'enabled',
      ownerId: record.ownerId ?? undefined,
    };
  }

  private toRecord(config: CustomAgentConfig): Omit<AgentConfigRecord, 'id' | 'createdAt' | 'updatedAt'> {
    return {
      agentId: config.agentId,
      name: config.name,
      label: config.label,
      description: config.description ?? null,
      systemPrompt: config.systemPrompt ?? null,
      projectJson: config.projectJson,
      dbConnectionEnc: this.encryptDb(config.db),
      status: config.status,
      lastError: null,
      ownerId: config.ownerId ?? null,
    };
  }

  private encryptDb(db: DatabaseConfig): string {
    return encryptSecret(JSON.stringify(db), this.opts.secretKey);
  }

  private decryptDb(encrypted: string): DatabaseConfig {
    return JSON.parse(decryptSecret(encrypted, this.opts.secretKey)) as DatabaseConfig;
  }
}

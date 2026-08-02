import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';
import { AgentRegistry, type CustomAgentFactory } from './registry';
import { InMemoryAgentConfigStore } from './store';
import type { CustomAgentConfig } from './types';

const SECRET = 'test-secret-key-0123456789-0123456789';

interface FakeSpec {
  id: string;
  label: string;
}

function makeConfig(agentId: string, overrides: Partial<CustomAgentConfig> = {}): CustomAgentConfig {
  return {
    agentId,
    name: `Agent ${agentId}`,
    label: `Agent ${agentId}`,
    mdl: 'name: demo\nmodels:\n  - name: t\n    table: demo_table',
    db: { host: 'localhost', port: 5432, database: 'demo', user: 'demo', password: 'demo' },
    status: 'enabled',
    ...overrides,
  };
}

function makeRegistry(store = new InMemoryAgentConfigStore(), failAgentId?: string) {
  let buildCount = 0;
  const factory: CustomAgentFactory<FakeSpec> = {
    async build(config) {
      buildCount += 1;
      if (config.agentId === failAgentId) {
        throw new Error(`build failed: ${config.agentId}`);
      }
      return { id: config.agentId, label: config.label };
    },
  };
  const registry = new AgentRegistry<FakeSpec>({ store, factory, secretKey: SECRET });
  return { registry, store, buildCount: () => buildCount };
}

describe('crypto', () => {
  it('round-trips and is not plaintext', () => {
    const enc = encryptSecret('{"password":"secret"}', SECRET);
    expect(enc).not.toContain('secret');
    expect(decryptSecret(enc, SECRET)).toBe('{"password":"secret"}');
  });

  it('fails to decrypt with a different key', () => {
    const enc = encryptSecret('hello', SECRET);
    expect(() => decryptSecret(enc, 'wrong-key-0000000000000000000000000')).toThrow();
  });
});

describe('AgentRegistry', () => {
  it('registers, lists and unregisters an agent', async () => {
    const { registry } = makeRegistry();
    const instance = await registry.register(makeConfig('erp'));
    expect(instance.id).toBe('erp');
    expect(registry.list().map((a) => a.id)).toEqual(['erp']);
    expect(registry.get('erp')?.label).toBe('Agent erp');

    expect(await registry.unregister('erp')).toBe(true);
    expect(registry.list()).toHaveLength(0);
    expect(await registry.unregister('erp')).toBe(false);
  });

  it('persists encrypted connection, never plaintext', async () => {
    const store = new InMemoryAgentConfigStore();
    const { registry } = makeRegistry(store);
    await registry.register(makeConfig('erp'));

    const record = await store.findByAgentId('erp');
    expect(record?.dbConnectionEnc).not.toContain('"password":"demo"');
    expect(record?.dbConnectionEnc).not.toContain('demo');
    // 管理展示脱敏
    const view = await registry.getRecord('erp');
    expect(view?.connectionMask).toBe('***@localhost:5432/demo');
    // 连接测试可解密
    const db = await registry.getDbConfig('erp');
    expect(db?.password).toBe('demo');
  });

  it('rejects duplicate agent ids', async () => {
    const { registry } = makeRegistry();
    await registry.register(makeConfig('erp'));
    await expect(registry.register(makeConfig('erp'))).rejects.toThrow(/already exists/);
  });

  it('update replaces the instance and persists changes', async () => {
    const store = new InMemoryAgentConfigStore();
    const { registry } = makeRegistry(store);
    await registry.register(makeConfig('erp', { label: 'Old' }));
    const updated = await registry.update('erp', { label: 'New', mdl: 'name: new\nmodels: []' });
    expect(updated?.label).toBe('New');
    expect(registry.get('erp')?.label).toBe('New');
    const record = await store.findByAgentId('erp');
    expect(record?.label).toBe('New');
    expect(record?.mdl).toContain('name: new');
  });

  it('keeps old instance when update build fails', async () => {
    const store = new InMemoryAgentConfigStore();
    let calls = 0;
    const registry = new AgentRegistry<FakeSpec>({
      store,
      factory: {
        async build(config) {
          calls += 1;
          if (calls > 1) throw new Error('build failed');
          return { id: config.agentId, label: config.label };
        },
      },
      secretKey: SECRET,
    });
    await registry.register(makeConfig('erp', { label: 'Old' }));
    await expect(registry.update('erp', { label: 'Broken' })).rejects.toThrow(/build failed/);
    expect(registry.get('erp')?.label).toBe('Old');
    expect(calls).toBe(2); // register(1) + failed update(1)
  });

  it('setStatus disables without deleting config', async () => {
    const store = new InMemoryAgentConfigStore();
    const { registry } = makeRegistry(store);
    await registry.register(makeConfig('erp'));
    await registry.setStatus('erp', 'disabled');
    expect(registry.get('erp')).toBeUndefined();
    expect(await store.findByAgentId('erp')).toBeDefined();
  });

  it('loadAll isolates failures and reports them', async () => {
    const store = new InMemoryAgentConfigStore();
    const { registry } = makeRegistry(store); // no failure during registration
    await registry.register(makeConfig('ok'));
    await registry.register(makeConfig('broken'));

    const second = new AgentRegistry<FakeSpec>({
      store,
      factory: {
        async build(config) {
          if (config.agentId === 'broken') throw new Error(`build failed: ${config.agentId}`);
          return { id: config.agentId, label: config.label };
        },
      },
      secretKey: SECRET,
    });
    const load = await second.loadAll();
    expect(load.loaded).toBe(1);
    expect(load.failed).toEqual([{ agentId: 'broken', error: 'build failed: broken' }]);
    expect(second.list().map((a) => a.id)).toEqual(['ok']);
    const brokenRecord = await store.findByAgentId('broken');
    expect(brokenRecord?.status).toBe('error');
    expect(brokenRecord?.lastError).toBe('build failed: broken');
  });
});

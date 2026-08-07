'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Switch } from 'animal-island-ui';

interface CustomAgentView {
  agentId: string;
  name: string;
  label: string;
  description: string | null;
  systemPrompt: string | null;
  mdl?: string;
  connection: string;
  status: string;
  lastError: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

interface AgentStatus {
  agentId: string;
  status: string;
  lastError: string | null;
  active: boolean;
  pool: PoolStats | null;
}

const EMPTY_FORM = {
  agentId: '',
  name: '',
  label: '',
  description: '',
  systemPrompt: '',
  mdl: '',
  ownerId: '',
  host: 'localhost',
  port: '5432',
  database: '',
  user: '',
  password: '',
};

type FormState = typeof EMPTY_FORM;

const TOKEN_KEY = 'piwren_admin_token';

export default function AgentsPage() {
  const [token, setToken] = useState('');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [agents, setAgents] = useState<CustomAgentView[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      void refresh(saved);
    }
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(`/api${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${response.status}）`);
      }
      return response.status === 204 ? null : response.json();
    },
    [token],
  );

  async function refresh(useToken = token) {
    if (!useToken) return;
    try {
      const data = (await api('/admin/agents')) as { agents: CustomAgentView[] };
      setAgents(data.agents);
      setMessage(null);
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '加载失败' });
    }
  }

  function setField(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function validateMdl() {
    setMessage(null);
    try {
      const data = (await api('/admin/agents/validate', {
        method: 'POST',
        body: JSON.stringify({ mdl: form.mdl }),
      })) as { models: string[] };
      setMessage({ kind: 'ok', text: `MDL 校验通过：模型表 ${data.models.join(', ')}` });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'MDL 校验失败' });
    }
  }

  async function testConnection() {
    setMessage(null);
    try {
      await api('/admin/agents/test', {
        method: 'POST',
        body: JSON.stringify({ db: dbFromForm(form) }),
      });
      setMessage({ kind: 'ok', text: '数据库连接成功' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '连接失败' });
    }
  }

  async function save() {
    setLoading(true);
    setMessage(null);
    try {
      const body = {
        agentId: form.agentId,
        name: form.name,
        label: form.label,
        description: form.description || undefined,
        systemPrompt: form.systemPrompt || undefined,
        mdl: form.mdl,
        ownerId: form.ownerId || undefined,
        db: dbFromForm(form),
      };
      if (editing) {
        await api(`/admin/agents/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
        setMessage({ kind: 'ok', text: `已更新 ${editing}` });
        setEditing(null);
      } else {
        await api('/admin/agents', { method: 'POST', body: JSON.stringify(body) });
        setMessage({ kind: 'ok', text: `已注册 ${form.agentId}` });
      }
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setLoading(false);
    }
  }

  async function startEdit(agent: CustomAgentView) {
    setMessage(null);
    try {
      const detail = (await api(`/admin/agents/${agent.agentId}`)) as { agent: CustomAgentView };
      const a = detail.agent;
      setEditing(a.agentId);
      setForm({
        agentId: a.agentId,
        name: a.name,
        label: a.label,
        description: a.description ?? '',
        systemPrompt: a.systemPrompt ?? '',
        mdl: a.mdl ?? '',
        ownerId: a.ownerId ?? '',
        host: '',
        port: '',
        database: '',
        user: '',
        password: '',
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '加载详情失败' });
    }
  }

  function remove(agentId: string) {
    setConfirmDelete(agentId);
  }

  async function doDelete(agentId: string) {
    setBusy(agentId);
    try {
      await api(`/admin/agents/${agentId}`, { method: 'DELETE' });
      setMessage({ kind: 'ok', text: `已注销 ${agentId}` });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '注销失败' });
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  }

  async function toggleStatus(agent: CustomAgentView) {
    setBusy(agent.agentId);
    try {
      await api(`/admin/agents/${agent.agentId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: agent.status === 'enabled' ? 'disabled' : 'enabled' }),
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '状态变更失败' });
    } finally {
      setBusy(null);
    }
  }

  async function testAgent(agentId: string) {
    setBusy(agentId);
    try {
      await api(`/admin/agents/${agentId}/test`, { method: 'POST' });
      setMessage({ kind: 'ok', text: `Agent ${agentId} 连接正常` });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : `Agent ${agentId} 连接失败` });
    } finally {
      setBusy(null);
    }
  }

  async function loadStatus(agentId: string) {
    try {
      const data = (await api(`/admin/agents/${agentId}/status`)) as AgentStatus;
      setStatuses((prev) => ({ ...prev, [agentId]: data }));
    } catch {
      // 忽略状态加载失败
    }
  }

  return (
    <main className="container">
      <div className="page-head">
        <h1>自定义 Agent 管理</h1>
        <span className="meta">自助注册 · AES-256-GCM 加密 · 操作审计</span>
      </div>
      <div className="card">
        <h2 className="section">接入与管理</h2>
        <p className="meta">
          用户提供 MDL + 数据库连接串即可注册专属查询 Agent。管理接口需 X-Admin-Token（生产环境建议接入 SSO/登录，勿在前端存储长期密钥）。
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <Input
            type="password"
            placeholder="X-Admin-Token"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              localStorage.setItem(TOKEN_KEY, e.target.value);
            }}
            style={{ maxWidth: 280 }}
          />
          <Button onClick={() => void refresh()} disabled={!token}>
            加载列表
          </Button>
        </div>
      </div>

      {message ? (
        <div className={message.kind === 'ok' ? 'card' : 'error-banner'}>{message.text}</div>
      ) : null}

      <div className="card">
        <h2 className="section">{editing ? `编辑 Agent：${editing}` : '注册新 Agent'}</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <Input
            placeholder="agentId（小写字母/数字/连字符，如 my-erp）"
            value={form.agentId}
            onChange={(e) => setField('agentId', e.target.value)}
            disabled={Boolean(editing)}
          />
          <Input
            placeholder="名称（如 ERP 查询）"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
          />
          <Input
            placeholder="标签（如 ERP 数据查询）"
            value={form.label}
            onChange={(e) => setField('label', e.target.value)}
          />
          <Input
            placeholder="ownerId（多租户归属，可选）"
            value={form.ownerId}
            onChange={(e) => setField('ownerId', e.target.value)}
          />
        </div>
        <textarea
          className="textarea"
          placeholder="描述（可选）"
          value={form.description}
          onChange={(e) => setField('description', e.target.value)}
          style={{ marginTop: 10 }}
        />
        <textarea
          className="textarea"
          placeholder="MDL（YAML 语义配置：models/intents/metrics/knowledge）"
          value={form.mdl}
          onChange={(e) => setField('mdl', e.target.value)}
          style={{ marginTop: 10, minHeight: 220, fontFamily: 'monospace' }}
        />
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => void validateMdl()} disabled={!form.mdl}>
            校验 MDL
          </Button>
        </div>

        <h3 className="section" style={{ marginTop: 14 }}>
          数据库连接
        </h3>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Input placeholder="host" value={form.host} onChange={(e) => setField('host', e.target.value)} />
          <Input placeholder="port" value={form.port} onChange={(e) => setField('port', e.target.value)} />
          <Input placeholder="database" value={form.database} onChange={(e) => setField('database', e.target.value)} />
          <Input placeholder="user" value={form.user} onChange={(e) => setField('user', e.target.value)} />
          <Input type="password" placeholder="password" value={form.password} onChange={(e) => setField('password', e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <Button onClick={() => void testConnection()} disabled={!form.database}>
            测试连接
          </Button>
          <Button onClick={() => void save()} disabled={loading || !token}>
            {loading ? '保存中…' : editing ? '保存修改' : '注册 Agent'}
          </Button>
          {editing ? (
            <Button
              onClick={() => {
                setEditing(null);
                setForm(EMPTY_FORM);
              }}
            >
              取消编辑
            </Button>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h2 className="section">已注册的自定义 Agent（{agents.length}）</h2>
        {agents.length === 0 ? (
          <p className="meta">暂无自定义 Agent，使用上方表单注册。</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>agentId</th>
                <th style={{ textAlign: 'left' }}>名称</th>
                <th style={{ textAlign: 'left' }}>状态</th>
                <th style={{ textAlign: 'left' }}>连接</th>
                <th style={{ textAlign: 'left' }}>池</th>
                <th style={{ textAlign: 'left' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agentId} style={{ borderTop: '1px solid var(--code-bg)' }}>
                  <td style={{ padding: '8px 4px' }}>{agent.agentId}</td>
                  <td style={{ padding: '8px 4px' }}>{agent.name}</td>
                  <td style={{ padding: '8px 4px' }}>
                    <span
                      className={agent.status === 'enabled' ? 'badge-ok' : agent.status === 'error' ? 'badge-error' : 'badge-obs'}
                      style={{ padding: '1px 8px', borderRadius: 999 }}
                    >
                      {agent.status}
                    </span>
                    {agent.lastError ? <span className="meta"> {agent.lastError}</span> : null}
                  </td>
                  <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 12 }}>{agent.connection}</td>
                  <td style={{ padding: '8px 4px', fontSize: 12 }}>
                    {renderPool(statuses[agent.agentId])}
                  </td>
                  <td style={{ padding: '8px 4px' }}>
                    <Button style={{ marginRight: 4 }} onClick={() => void loadStatus(agent.agentId)} disabled={busy === agent.agentId}>
                      监控
                    </Button>
                    <Button style={{ marginRight: 4 }} onClick={() => void testAgent(agent.agentId)} disabled={busy === agent.agentId}>
                      测试
                    </Button>
                    <span style={{ marginRight: 8, verticalAlign: 'middle' }}>
                      <Switch
                        checked={agent.status === 'enabled'}
                        onChange={() => void toggleStatus(agent)}
                        disabled={busy === agent.agentId}
                      />
                    </span>
                    <Button style={{ marginRight: 4 }} onClick={() => void startEdit(agent)} disabled={busy === agent.agentId}>
                      编辑
                    </Button>
                    <Button onClick={() => void remove(agent.agentId)} disabled={busy === agent.agentId}>
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="meta" style={{ marginTop: 12 }}>
        <a href="/chat" style={{ color: 'inherit' }}>
          ← 返回聊天页
        </a>
      </p>

      <Modal
        open={Boolean(confirmDelete)}
        title="注销 Agent"
        maskClosable
        onClose={() => setConfirmDelete(null)}
        onOk={() => confirmDelete && void doDelete(confirmDelete)}
      >
        确认注销 Agent「{confirmDelete}」？此操作不可恢复。
      </Modal>
    </main>
  );
}

function renderPool(status: AgentStatus | undefined): string {
  const pool = status?.pool;
  return pool ? `总 ${pool.total} / 空闲 ${pool.idle}` : '—';
}

function dbFromForm(form: FormState) {
  return {
    host: form.host || 'localhost',
    port: Number(form.port || 5432),
    database: form.database,
    user: form.user,
    password: form.password,
  };
}

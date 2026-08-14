'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal } from 'animal-island-ui';
import { apiFetch } from '../lib/api';

interface UserView {
  userId: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
}

const TOKEN_KEY = 'piwren_admin_token';

/** 用户管理（仅 admin）：创建/角色/启停/重置口令。鉴权 = 登录会话（admin）或 X-Admin-Token。 */
export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersInner />
    </Suspense>
  );
}

function UsersInner() {
  const [token, setToken] = useState('');
  const [users, setUsers] = useState<UserView[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'user' });
  const [resetTarget, setResetTarget] = useState<UserView | null>(null);
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
    }
    // 未存 token 也先试一次（AUTH_ENABLED 时 admin 会话可直接过）
    void refresh('');
  }, []);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await apiFetch(`/api${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
          ...(init?.headers ?? {}),
        },
      });
      if (response.status === 401) {
        throw new Error('需要 admin 权限：请先登录 admin 账号，或在下方填入 X-Admin-Token');
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${response.status}）`);
      }
      return response.status === 204 ? null : response.json();
    },
    [token],
  );

  async function refresh(useToken = token) {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (useToken) headers['x-admin-token'] = useToken;
      const response = await apiFetch('/api/admin/users', { headers });
      if (response.status === 401) {
        setMessage({ kind: 'err', text: '需要 admin 权限：请先登录 admin 账号，或在下方填入 X-Admin-Token' });
        return;
      }
      if (!response.ok) {
        throw new Error(`加载失败（${response.status}）`);
      }
      const data = (await response.json()) as { users: UserView[] };
      setUsers(data.users ?? []);
      setMessage(null);
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '加载失败' });
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    setMessage(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim() || undefined,
          role: form.role,
        }),
      });
      setMessage({ kind: 'ok', text: `用户 ${form.username.trim()} 已创建` });
      setForm({ username: '', password: '', displayName: '', role: 'user' });
      setCreateOpen(false);
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '创建失败' });
    }
  }

  async function toggleStatus(user: UserView) {
    const next = user.status === 'active' ? 'disabled' : 'active';
    try {
      await api(`/admin/users/${encodeURIComponent(user.userId)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' });
    }
  }

  async function changeRole(user: UserView, role: string) {
    try {
      await api(`/admin/users/${encodeURIComponent(user.userId)}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      await refresh();
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '操作失败' });
    }
  }

  async function resetPassword() {
    if (!resetTarget) return;
    try {
      await api(`/admin/users/${encodeURIComponent(resetTarget.userId)}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      });
      setMessage({ kind: 'ok', text: `已重置 ${resetTarget.username} 的口令` });
      setResetTarget(null);
      setNewPassword('');
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : '重置失败' });
    }
  }

  return (
    <main className="container">
      <div className="page-head">
        <h1>用户管理</h1>
        <span className="meta">登录账号 · 角色 · 启停 · 口令重置（全部操作审计）</span>
      </div>

      {message?.kind === 'err' ? <div className="error-banner">{message.text}</div> : null}
      {message?.kind === 'ok' ? (
        <div className="error-banner" style={{ color: '#3e7d4f' }}>
          {message.text}
        </div>
      ) : null}

      <div className="card">
        <h2 className="section">账号列表</h2>
        <p className="meta">
          管理接口需 admin 权限：登录 admin 账号即可，或填入 X-Admin-Token（AUTH_ENABLED=false 时仅支持 Token）。
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
          <Button onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建用户
          </Button>
        </div>

        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>用户名</th>
              <th>显示名</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.username}</td>
                <td>{u.displayName}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => void changeRole(u, e.target.value)}
                    style={{ padding: '4px 8px', border: '1px solid #d9c8a9', borderRadius: 6 }}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <span className={'topbar-status' + (u.status === 'active' ? '' : ' off')}>
                    <i />
                    {u.status}
                  </span>
                </td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <Button size="small" onClick={() => void toggleStatus(u)}>
                    {u.status === 'active' ? '停用' : '启用'}
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      setResetTarget(u);
                      setNewPassword('');
                    }}
                  >
                    重置口令
                  </Button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#a08356' }}>
                  暂无数据（未启用认证时可先在 .env 配置 AUTH_ENABLED=true 并重启后端）
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        title="新建用户"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onOk={() => void createUser()}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <Input
            placeholder="用户名（2-64 位字母/数字/_.-）"
            value={form.username}
            onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
          />
          <Input
            type="password"
            placeholder="口令（至少 8 位）"
            value={form.password}
            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
          />
          <Input
            placeholder="显示名（可选）"
            value={form.displayName}
            onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
          />
          <select
            value={form.role}
            onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
            style={{ padding: '8px', border: '1px solid #d9c8a9', borderRadius: 6 }}
          >
            <option value="user">user（普通用户）</option>
            <option value="admin">admin（管理员）</option>
          </select>
        </div>
      </Modal>

      <Modal
        title={`重置口令：${resetTarget?.username ?? ''}`}
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        onOk={() => void resetPassword()}
      >
        <Input
          type="password"
          placeholder="新口令（至少 8 位）"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Modal>
    </main>
  );
}

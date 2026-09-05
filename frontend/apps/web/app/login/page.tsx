'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** 登录页：AUTH_ENABLED=true 时挡在业务页前；未启用认证时自动跳回业务页。 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const nextUrl = search.get('next') || '/chat';

  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          enabled?: boolean;
          user?: { displayName: string } | null;
        };
        if (cancelled) return;
        if (body.enabled === false) {
          router.replace(nextUrl); // 未启用认证：直接进入业务页
        } else if (response.ok && body.user) {
          router.replace(nextUrl); // 已登录：跳过登录页
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router, nextUrl]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error === 'auth is disabled' ? '系统未启用登录' : '用户名或密码错误');
      }
      window.location.href = nextUrl; // 整页跳转让 Cookie 生效并重载会话状态
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className="login-page">
        <div className="login-card">
          <p className="login-hint" style={{ margin: 0 }}>
            正在检查登录状态…
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="doc-brand-badge">PW</span>
          <div>
            <h1 className="login-title">PI·WREN 数据智能平台</h1>
            <p className="login-hint">请登录后继续使用</p>
          </div>
        </div>
        <form onSubmit={submit} className="login-form">
          <label className="query-field">
            <span className="query-field-label">用户名</span>
            <input
              className="input"
              placeholder="请输入用户名"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="query-field">
            <span className="query-field-label">密码</span>
            <input
              className="input"
              placeholder="请输入密码"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn" disabled={submitting || !username.trim() || !password}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
      </div>
    </main>
  );
}

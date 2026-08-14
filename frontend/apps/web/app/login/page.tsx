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
      <main style={{ ...cardStyle, color: '#8d6e4c' }}>正在检查登录状态…</main>
    );
  }

  return (
    <main style={cardStyle}>
      <h1 style={{ margin: 0, fontSize: 22, color: '#5b3e1e' }}>PI·WREN 数据岛</h1>
      <p style={{ margin: '4px 0 20px', fontSize: 13, color: '#a08356' }}>请登录后继续使用</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 280 }}>
        <input
          style={inputStyle}
          placeholder="用户名"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="密码"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p style={{ margin: 0, fontSize: 13, color: '#c0564a' }}>{error}</p>}
        <button
          type="submit"
          style={buttonStyle}
          disabled={submitting || !username.trim() || !password}
        >
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f6efe3',
  fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #d9c8a9',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  background: '#fffdf8',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  color: '#fffdf8',
  background: '#8d6e4c',
  cursor: 'pointer',
};

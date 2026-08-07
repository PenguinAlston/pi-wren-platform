'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function resolveTitle(pathname: string, search: URLSearchParams): { title: string; crumb: string } {
  if (pathname === '/') {
    return { title: '总览', crumb: '导航 / 总览' };
  }
  if (pathname === '/query') {
    const map: Record<string, string> = { contract: '契约查询', preserve: '保全查询', claim: '理赔查询' };
    const moduleName = map[search.get('m') ?? ''];
    return {
      title: moduleName ?? '传统查询',
      crumb: moduleName ? `业务查询 / ${moduleName}` : '业务查询 / 传统查询',
    };
  }
  if (pathname === '/chat') {
    return { title: 'AI 智能问答', crumb: '业务查询 / AI 智能问答' };
  }
  if (pathname === '/agents') {
    return { title: '自定义 Agent', crumb: '系统管理 / 自定义 Agent' };
  }
  return { title: 'PI·WREN 数据岛', crumb: '导航' };
}

function useClock(): string {
  const [now, setNow] = useState('');
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setNow(
        d.getFullYear() +
          '-' +
          pad(d.getMonth() + 1) +
          '-' +
          pad(d.getDate()) +
          ' ' +
          pad(d.getHours()) +
          ':' +
          pad(d.getMinutes()) +
          ':' +
          pad(d.getSeconds()),
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** 顶部栏：当前菜单的详细名称 + 面包屑 + 时钟/系统状态。 */
export default function DocTopbar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const clock = useClock();
  const [online, setOnline] = useState<boolean | null>(null);
  const { title, crumb } = resolveTitle(pathname, search);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((body: { status?: string }) => {
        if (!cancelled) {
          setOnline(body.status === 'ok');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOnline(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <header className="doc-topbar">
      <div className="doc-topbar-title">
        <span className="doc-topbar-crumb">{crumb}</span>
        <h1>{title}</h1>
      </div>
      <div className="topbar-right">
        <span className="topbar-clock">{clock}</span>
        <span className={'topbar-status' + (online === false ? ' off' : '')}>
          <i />
          {online === true ? 'SYS·OK' : online === false ? 'SYS·ERR' : 'SYS·…'}
        </span>
      </div>
    </header>
  );
}

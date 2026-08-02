'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: '总览', icon: '◈', code: 'HUB' },
  { href: '/query', label: '传统查询', icon: '▦', code: 'DBQ' },
  { href: '/chat', label: 'AI 问答', icon: '◎', code: 'CHAT' },
  { href: '/agents', label: '自定义 Agent', icon: '✦', code: 'AGENT' },
];

const SECTION_TITLES = [
  { match: /^\/query/, title: '传统业务查询', eyebrow: 'TRADITIONAL QUERY' },
  { match: /^\/chat/, title: 'AI 智能问答', eyebrow: 'AI CHAT CONSOLE' },
  { match: /^\/agents/, title: '自定义 Agent 管理', eyebrow: 'AGENT REGISTRY' },
  { match: /^\//, title: '企业数据智能平台', eyebrow: 'PI · WREN PLATFORM' },
];

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

/** 全局外壳：左侧轨道导航 + 顶栏（实时时钟 / 系统状态）。 */
export default function Nav() {
  const pathname = usePathname();
  const clock = useClock();
  const [online, setOnline] = useState<boolean | null>(null);

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

  const section =
    SECTION_TITLES.find((s) => s.match.test(pathname)) ?? {
      title: '企业数据智能平台',
      eyebrow: 'PI · WREN PLATFORM',
    };

  return (
    <>
      <aside className="app-rail">
        <div className="rail-brand">
          <span className="rail-logo">PW</span>
          <span className="rail-name">
            PI · WREN
            <small>INSIGHT CONSOLE</small>
          </span>
        </div>

        <nav className="rail-nav">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={'rail-item' + (active ? ' active' : '')}
              >
                <span className="rail-icon">{item.icon}</span>
                <span className="rail-label">{item.label}</span>
                <span className="rail-hint">{item.code}</span>
              </Link>
            );
          })}
        </nav>

        <div className="rail-foot">
          <span className={'dot' + (online === true ? ' on' : online === false ? ' off' : '')} />
          <span className="rail-foot-label">
            {online === true ? 'API ONLINE' : online === false ? 'API OFFLINE' : 'CONNECTING…'}
          </span>
        </div>
      </aside>

      <header className="app-topbar">
        <div className="topbar-title">
          <span>{section.title}</span>
          <span className="eyebrow">{section.eyebrow}</span>
        </div>
        <div className="topbar-right">
          <span className="topbar-clock">{clock}</span>
          <span className={'topbar-status' + (online === false ? ' off' : '')}>
            <i />
            {online === true ? 'SYS·OK' : online === false ? 'SYS·ERR' : 'SYS·…'}
          </span>
        </div>
      </header>
    </>
  );
}

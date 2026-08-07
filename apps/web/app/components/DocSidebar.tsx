'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface MenuItem {
  href: string;
  label: string;
  group: string;
  isActive: (pathname: string, search: URLSearchParams) => boolean;
}

const MENU: MenuItem[] = [
  { href: '/', label: '总览', group: '导航', isActive: (p) => p === '/' },
  {
    href: '/query?m=contract',
    label: '契约查询',
    group: '业务查询',
    isActive: (p, s) => p === '/query' && s.get('m') === 'contract',
  },
  {
    href: '/query?m=preserve',
    label: '保全查询',
    group: '业务查询',
    isActive: (p, s) => p === '/query' && s.get('m') === 'preserve',
  },
  {
    href: '/query?m=claim',
    label: '理赔查询',
    group: '业务查询',
    isActive: (p, s) => p === '/query' && s.get('m') === 'claim',
  },
  { href: '/chat', label: 'AI 智能问答', group: '业务查询', isActive: (p) => p === '/chat' },
  { href: '/agents', label: '自定义 Agent', group: '系统管理', isActive: (p) => p === '/agents' },
];

const GROUPS = ['导航', '业务查询', '系统管理'];

/** 左侧导航栏：分组菜单（契约/保全/理赔/AI 问答/自定义 Agent）。 */
export default function DocSidebar() {
  return (
    <Suspense fallback={<aside className="doc-aside" />}>
      <DocSidebarInner />
    </Suspense>
  );
}

function DocSidebarInner() {
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <aside className="doc-aside">
      <div className="doc-brand">
        <span className="doc-brand-badge">PW</span>
        <span>
          PI·WREN
          <small>数据岛</small>
        </span>
      </div>

      <nav className="doc-menu">
        {GROUPS.map((group) => (
          <div key={group} className="doc-menu-group">
            <div className="doc-menu-label">{group}</div>
            {MENU.filter((item) => item.group === group).map((item) => {
              const active = item.isActive(pathname, search);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={'doc-menu-item' + (active ? ' active' : '')}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

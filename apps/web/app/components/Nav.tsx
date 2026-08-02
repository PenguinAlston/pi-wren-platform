'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: '首页' },
  { href: '/query', label: '传统查询' },
  { href: '/chat', label: 'AI 问答' },
  { href: '/agents', label: '自定义 Agent' },
];

/** 顶部固定导航栏：区分【传统查询】【AI问答】（需求 3.1）。 */
export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="nav-bar">
      <span className="nav-brand">Pi Wren 保险查询平台</span>
      <nav className="nav-links">
        {ITEMS.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-link${active ? ' active' : ''}`}>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

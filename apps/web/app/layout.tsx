import type { Metadata } from 'next';
import './globals.css';
import Nav from './components/Nav';

export const metadata: Metadata = {
  title: 'PI·WREN 企业数据智能平台',
  description: '保险业务传统查询 + AI 智能问答双模式查询系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="aurora" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="app-shell">
          <Nav />
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}

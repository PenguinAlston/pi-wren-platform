import type { Metadata } from 'next';
import './globals.css';
import DocSidebar from './components/DocSidebar';
import DocTopbar from './components/DocTopbar';

export const metadata: Metadata = {
  title: 'PI·WREN 数据智能平台',
  description: '保险业务传统查询 + AI 智能问答双模式企业数据平台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="doc-layout">
          <DocSidebar />
          <div className="doc-main">
            <DocTopbar />
            <main className="doc-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

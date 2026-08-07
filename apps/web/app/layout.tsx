import type { Metadata } from 'next';
import './globals.css';
import AnimalIslandProvider from './components/AnimalIslandProvider';
import DocSidebar from './components/DocSidebar';
import DocTopbar from './components/DocTopbar';

export const metadata: Metadata = {
  title: 'PI·WREN 动物之森数据岛',
  description: '保险业务传统查询 + AI 智能问答双模式查询系统（Animal Island UI）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AnimalIslandProvider>
          <div className="doc-layout">
            <DocSidebar />
            <div className="doc-main">
              <DocTopbar />
              <main className="doc-content">{children}</main>
            </div>
          </div>
        </AnimalIslandProvider>
      </body>
    </html>
  );
}

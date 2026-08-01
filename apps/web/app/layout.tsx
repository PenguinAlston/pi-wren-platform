import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pi Wren Platform',
  description: 'Enterprise natural-language analytics platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

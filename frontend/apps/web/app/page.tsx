import type { Metadata } from 'next';
import AssistantHome from './components/AssistantHome';

export const metadata: Metadata = {
  title: '智能助手 · PI·WREN',
  description: '对话式企业数据智能助手首页',
};

export default function Home() {
  return <AssistantHome />;
}

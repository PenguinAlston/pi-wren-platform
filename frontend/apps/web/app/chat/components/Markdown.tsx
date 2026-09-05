'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 渲染组件：支持 GFM（表格/列表/删除线/代码块）。
 * 用于 AI 回答的富文本展示（标题/加粗/列表/表格/代码）。
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

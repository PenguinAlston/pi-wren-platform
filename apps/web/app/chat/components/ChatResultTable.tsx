'use client';

import { useState } from 'react';
import { formatCell, toCsv } from './chat-utils';

interface Props {
  data: Record<string, unknown>[];
}

const PAGE_SIZE = 10;

/** AI 回复的结构化表格（需求 4.3.2-2）：分页 + 导出。 */
export default function ChatResultTable({ data }: Props) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(Math.ceil(data.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, totalPages);
  const slice = data.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const headers = Object.keys(data[0] ?? {});

  const exportCsv = () => {
    const blob = new Blob([`\uFEFF${toCsv(data)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ai-result-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (data.length === 0) {
    return <p className="meta">查询未返回数据。</p>;
  }

  return (
    <div>
      <div className="ai-table-toolbar">
        <span className="meta">共 {data.length} 行 · 第 {safePage}/{totalPages} 页</span>
        <button className="btn btn-secondary btn-sm" onClick={exportCsv}>
          导出 CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, index) => (
              <tr key={index}>
                {headers.map((header) => (
                  <td key={header}>{formatCell(row[header])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        <div className="query-pagination">
          <button
            className="btn btn-secondary btn-sm"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
          >
            上一页
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={safePage >= totalPages}
            onClick={() => setPage(safePage + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}

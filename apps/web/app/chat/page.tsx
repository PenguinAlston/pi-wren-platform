'use client';

import { useState } from 'react';
import type { AgentRunResult } from '@pi-wren/shared-types';
import { TracePanel } from './components/TracePanel';
import { ResultTable } from './components/ResultTable';

const EXAMPLES = ['为什么利润下降了？', '本季度收入趋势如何？', '成本变化情况如何？'];

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    const message = input.trim();
    if (!message || loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${response.status}）`);
      }

      setResult((await response.json()) as AgentRunResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <h1 className="title">财务分析 Agent</h1>
        <p className="meta">用自然语言向企业数据提问，获取业务分析结论。</p>
      </div>

      <div className="card">
        <textarea
          className="input"
          value={input}
          placeholder="例如：为什么利润下降了？"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              void send();
            }
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn" onClick={() => void send()} disabled={loading || !input.trim()}>
            {loading ? '分析中…' : '分析'}
          </button>
          <span className="meta">⌘/Ctrl + Enter 提交</span>
        </div>

        <div style={{ marginTop: 12 }}>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              className="btn btn-secondary"
              style={{ marginRight: 8, marginBottom: 8 }}
              onClick={() => setInput(example)}
              disabled={loading}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {result ? (
        <>
          <div className="card">
            <h2 className="section">分析结论</h2>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.answer}</p>
            <p className="meta" style={{ marginTop: 12 }}>
              会话 {result.sessionId.slice(0, 8)} · 耗时 {result.durationMs}ms
              {result.error ? ` · 出现错误：${result.error}` : ''}
            </p>
          </div>

          <div className="card">
            <h2 className="section">执行轨迹</h2>
            <TracePanel events={result.events} />
          </div>

          {result.sql ? (
            <div className="card">
              <h2 className="section">生成的 SQL</h2>
              <pre className="code">{result.sql}</pre>
            </div>
          ) : null}

          {result.data ? (
            <div className="card">
              <h2 className="section">查询结果（{result.data.length} 行）</h2>
              <ResultTable data={result.data} />
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

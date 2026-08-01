'use client';

import { useEffect, useState } from 'react';
import type { AgentEvent, AgentRunResult } from '@pi-wren/shared-types';
import { TracePanel } from './components/TracePanel';
import { ResultTable } from './components/ResultTable';

interface AgentInfo {
  id: string;
  label: string;
  description: string;
}

interface SseFrame {
  event: string;
  data: string;
}

const EXAMPLES: Record<string, string[]> = {
  finance: ['为什么利润下降了？', '本季度收入趋势如何？', '成本变化情况如何？'],
  insurance: ['各险种的赔付率如何？', '保费规模按险种分布？', '理赔案件的进度如何？', '近期保全业务有哪些？', '核保结果如何？'],
};

/** 解析 SSE 文本流为帧列表。 */
function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    const event = part.match(/^event: (.+)$/m)?.[1];
    const data = part.match(/^data: (.+)$/m)?.[1];
    if (event && data !== undefined) {
      frames.push({ event, data });
    }
  }
  return { frames, rest };
}

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [domain, setDomain] = useState('finance');
  const [input, setInput] = useState('');
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [liveEvents, setLiveEvents] = useState<AgentEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/agents')
      .then((response) => response.json())
      .then((data: { agents: AgentInfo[] }) => {
        if (data.agents.length > 0) {
          setAgents(data.agents);
        }
      })
      .catch(() => {
        // 服务未就绪时保持默认，不阻塞页面
      });
  }, []);

  const activeLabel = agents.find((agent) => agent.id === domain)?.label ?? 'Agent';

  async function send() {
    const message = input.trim();
    if (!message || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setLiveEvents([]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(`/api/agent/${domain}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${response.status}）`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          if (frame.event === 'done') {
            const run = JSON.parse(frame.data) as AgentRunResult;
            setResult(run);
            setSessionId(run.sessionId);
          } else {
            setLiveEvents((prev) => [...prev, JSON.parse(frame.data) as AgentEvent]);
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('请求超时（120 秒），请重试或换用更快的模型');
      } else {
        setError(err instanceof Error ? err.message : '请求失败，请稍后重试');
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <h1 className="title">企业数据分析 Agent</h1>
        <p className="meta">用自然语言向企业数据提问，获取业务分析结论。支持多轮续聊（会话记忆已持久化）。</p>
      </div>

      {agents.length > 0 ? (
        <div className="card" style={{ padding: 12 }}>
          {agents.map((agent) => (
            <button
              key={agent.id}
              className="btn"
              style={{
                marginRight: 8,
                opacity: domain === agent.id ? 1 : 0.55,
                background: domain === agent.id ? undefined : 'var(--code-bg)',
                color: domain === agent.id ? undefined : 'var(--text)',
              }}
              onClick={() => {
                setDomain(agent.id);
                setResult(null);
                setError(null);
                setSessionId(undefined);
              }}
              disabled={loading}
            >
              {agent.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2 className="section">{activeLabel}</h2>
        <textarea
          className="input"
          value={input}
          placeholder={domain === 'insurance' ? '例如：各险种的赔付率如何？' : '例如：为什么利润下降了？'}
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
          {sessionId && !loading ? (
            <span className="meta" style={{ marginLeft: 'auto' }}>
              会话 {sessionId.slice(0, 8)}
            </span>
          ) : null}
        </div>

        <div style={{ marginTop: 12 }}>
          {(EXAMPLES[domain] ?? []).map((example) => (
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

      {loading || result ? (
        <>
          <div className="card">
            <h2 className="section">执行轨迹{loading ? '（实时）' : ''}</h2>
            <TracePanel events={loading ? liveEvents : (result?.events ?? liveEvents)} />
          </div>
        </>
      ) : null}

      {result ? (
        <>
          <div className="card">
            <h2 className="section">分析结论</h2>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{result.answer}</p>
            <p className="meta" style={{ marginTop: 12 }}>
              {activeLabel} · 会话 {result.sessionId.slice(0, 8)} · 耗时 {result.durationMs}ms
              {result.error ? ` · 出现错误：${result.error}` : ''}
            </p>
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

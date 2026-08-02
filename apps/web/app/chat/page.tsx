'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentRunResult } from '@pi-wren/shared-types';
import ChatChart from './components/ChatChart';
import ChatResultTable from './components/ChatResultTable';
import SessionSidebar, { type SessionSummary } from './components/SessionSidebar';
import { TracePanel } from './components/TracePanel';

interface AgentInfo {
  id: string;
  label: string;
  description: string;
}

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  events?: AgentEvent[];
  loading?: boolean;
  error?: boolean;
}

interface SseFrame {
  event: string;
  data: string;
}

const EXAMPLES: Record<string, string[]> = {
  finance: ['为什么利润下降了？', '本季度收入趋势如何？', '成本变化情况如何？'],
  insurance: [
    '各险种的赔付率如何？',
    '保费规模按险种分布？',
    '理赔案件的进度如何？',
    '近期保全业务有哪些？',
    '核保结果如何？',
  ],
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

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg-${Date.now()}-${messageSeq}`;
}

/** AI 智能问答页（需求第 4 章）：复刻 chat.qwen.ai 会话形态，保留原有问答链路。 */
export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [domain, setDomain] = useState('finance');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsSearch, setSessionsSearch] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async (search?: string) => {
    const query = search ?? sessionsSearch;
    try {
      const response = await fetch(`/api/sessions${query ? `?search=${encodeURIComponent(query)}` : ''}`);
      if (response.ok) {
        const body = (await response.json()) as { sessions: SessionSummary[] };
        setSessions(body.sessions ?? []);
      }
    } catch {
      // 服务未就绪时保持现状
    }
  }, [sessionsSearch]);

  useEffect(() => {
    fetch('/api/agents')
      .then((response) => response.json())
      .then((data: { agents: AgentInfo[] }) => {
        if (data.agents.length > 0) {
          setAgents(data.agents);
        }
      })
      .catch(() => {
        // 忽略：服务未就绪时保持默认 Agent
      });
    void loadSessions();
  }, [loadSessions]);

  // 新消息自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const activeLabel = agents.find((agent) => agent.id === domain)?.label ?? 'Agent';

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessageItem>) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const send = useCallback(
    async (explicitMessage?: string) => {
      const message = (explicitMessage ?? input).trim();
      if (!message || loading) {
        return;
      }
      setLoading(true);
      setError(null);

      const userMessage: ChatMessageItem = { id: nextMessageId(), role: 'user', content: message };
      const assistantId = nextMessageId();
      const assistantMessage: ChatMessageItem = {
        id: assistantId,
        role: 'assistant',
        content: '',
        loading: true,
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      try {
        const response = await fetch(`/api/agent/${domain}/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, sessionId: activeSessionId }),
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
              patchMessage(assistantId, {
                content: run.answer,
                sql: run.sql,
                data: run.data,
                events: run.events,
                loading: false,
              });
              setActiveSessionId(run.sessionId);
              void loadSessions();
            } else {
              const event = JSON.parse(frame.data) as AgentEvent;
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantId
                    ? { ...item, events: [...(item.events ?? []), event] }
                    : item,
                ),
              );
            }
          }
        }
      } catch (err) {
        const detail =
          err instanceof DOMException && err.name === 'AbortError'
            ? '请求超时（120 秒），请重试或换用更快的模型'
            : err instanceof Error
              ? err.message
              : '请求失败，请稍后重试';
        patchMessage(assistantId, { content: detail, error: true, loading: false });
        setError(detail);
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    },
    [input, loading, domain, activeSessionId, patchMessage, loadSessions],
  );

  const newSession = useCallback(() => {
    setMessages([]);
    setActiveSessionId(undefined);
    setError(null);
  }, []);

  const switchDomain = (next: string) => {
    setDomain(next);
    newSession();
  };

  const openSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (!response.ok) {
        throw new Error(`会话加载失败（${response.status}）`);
      }
      const body = (await response.json()) as {
        name: string;
        messages: {
          question: string;
          answer: string;
          sql?: string;
          data?: Record<string, unknown>[];
          createdAt: string;
        }[];
      };
      const items: ChatMessageItem[] = [];
      for (const record of body.messages) {
        items.push({ id: nextMessageId(), role: 'user', content: record.question });
        items.push({
          id: nextMessageId(),
          role: 'assistant',
          content: record.answer,
          sql: record.sql,
          data: record.data,
        });
      }
      setMessages(items);
      setActiveSessionId(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '会话加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, name: string) => {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      void loadSessions(sessionsSearch);
    },
    [loadSessions, sessionsSearch],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        if (sessionId === activeSessionId) {
          setMessages([]);
          setActiveSessionId(undefined);
        }
        void loadSessions(sessionsSearch);
      }
    },
    [activeSessionId, loadSessions, sessionsSearch],
  );

  const copyAnswer = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // 剪贴板不可用时忽略
    }
  };

  const autoGrow = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  };

  return (
    <main className="chat-layout">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        search={sessionsSearch}
        onSearchChange={setSessionsSearch}
        onSelect={(sessionId) => void openSession(sessionId)}
        onNew={newSession}
        onRename={(sessionId, name) => void renameSession(sessionId, name)}
        onDelete={(sessionId) => void deleteSession(sessionId)}
      />

      <section className="chat-main">
        <header className="chat-header">
          <div className="chat-agents">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`chat-agent-btn${domain === agent.id ? ' active' : ''}`}
                onClick={() => switchDomain(agent.id)}
                disabled={loading}
              >
                {agent.label}
              </button>
            ))}
          </div>
          <div className="chat-header-right">
            {activeSessionId ? <span className="meta">会话 {activeSessionId.slice(0, 8)}</span> : null}
            {messages.length > 0 ? (
              <button className="link-btn" onClick={newSession} disabled={loading}>
                清空会话
              </button>
            ) : null}
          </div>
        </header>

        <div className="chat-messages">
          {messages.length === 0 && !loading ? (
            <div className="chat-empty">
              <h2 className="chat-empty-title">{activeLabel}</h2>
              <p className="meta">用自然语言向企业数据提问，支持多轮递进追问与历史会话回看。</p>
              <div className="chat-examples">
                {(EXAMPLES[domain] ?? []).map((example) => (
                  <button
                    key={example}
                    className="btn btn-secondary btn-sm"
                    onClick={() => void send(example)}
                    disabled={loading}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="chat-row user">
                <div className="chat-bubble user">{message.content}</div>
              </div>
            ) : (
              <div key={message.id} className="chat-row assistant">
                <div className={`chat-bubble assistant${message.error ? ' error' : ''}`}>
                  {message.loading ? (
                    <span className="chat-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <>
                      {message.content ? <p className="chat-answer">{message.content}</p> : null}
                      {message.error ? (
                        <button className="link-btn" onClick={() => void retryLast()}>
                          重试
                        </button>
                      ) : null}
                      {message.data && message.data.length > 0 ? (
                        <>
                          <ChatChart data={message.data} />
                          <ChatResultTable data={message.data} />
                        </>
                      ) : null}
                      {message.sql ? (
                        <details className="chat-details">
                          <summary>查看 SQL</summary>
                          <pre className="code">{message.sql}</pre>
                        </details>
                      ) : null}
                      {message.events && message.events.length > 0 ? (
                        <details className="chat-details">
                          <summary>执行轨迹（{message.events.length}）</summary>
                          <TracePanel events={message.events} />
                        </details>
                      ) : null}
                      <div className="chat-bubble-actions">
                        <button
                          className="link-btn"
                          onClick={() => void copyAnswer(message.id, message.content)}
                        >
                          {copiedId === message.id ? '已复制' : '复制'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ),
          )}

          {error && !messages.some((m) => m.loading) ? (
            <div className="error-banner">{error}</div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>

        <footer className="chat-input-bar">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={`向${activeLabel}提问…（⌘/Ctrl + Enter 发送）`}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="btn" onClick={() => void send()} disabled={loading || !input.trim()}>
            {loading ? '分析中…' : '发送'}
          </button>
        </footer>
      </section>
    </main>
  );

  function retryLast() {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      void send(lastUser.content);
    }
  }
}

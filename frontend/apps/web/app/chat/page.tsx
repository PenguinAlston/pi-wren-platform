'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Collapse, Switch } from '../components/ui';
import type { AgentEvent, AgentRunResult } from '@pi-wren/shared-types';
import { apiFetch } from '../lib/api';
import ChatChart from './components/ChatChart';
import ChatResultTable from './components/ChatResultTable';
import SessionSidebar, { type SessionSummary } from './components/SessionSidebar';
import { ThinkingStream } from './components/ThinkingStream';
import { Markdown } from './components/Markdown';
import { MessageActions } from './components/MessageActions';
import { parseSseFrames, formatClock, type FeedbackValue } from './components/chat-utils';

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
  /** 落库消息 id（done 帧返回或历史回看带出）；缺失时反馈按钮禁用。 */
  messageId?: number;
  feedback?: FeedbackValue;
  /** 回答时间（HH:mm），动作行灰字展示。 */
  time?: string;
}

const EXAMPLES: Record<string, string[]> = {
  insurance: [
    '各险种的赔付率如何？',
    '保费规模按险种分布？',
    '理赔案件的进度如何？',
    '近期保全业务有哪些？',
    '核保结果如何？',
  ],
};

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq += 1;
  return `msg-${Date.now()}-${messageSeq}`;
}

/** AI 智能问答页（需求第 4 章）：复刻 chat.qwen.ai 会话形态，保留原有问答链路。 */
export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [domain, setDomain] = useState('insurance');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsSearch, setSessionsSearch] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pi 编排灰度开关（M1）：开启后走 /api/assistant/*（Pi 多工具编排），关闭走经典问数
  const [piMode, setPiMode] = useState(false);
  useEffect(() => {
    setPiMode(localStorage.getItem('piwren_assistant_mode') === '1');
  }, []);
  const togglePiMode = useCallback(() => {
    setPiMode((prev) => {
      const next = !prev;
      localStorage.setItem('piwren_assistant_mode', next ? '1' : '0');
      return next;
    });
    setMessages([]);
    setActiveSessionId(undefined);
    setError(null);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(async (search?: string, agent?: string) => {
    const query = search ?? sessionsSearch;
    try {
      // Pi 模式会话列表来自编排层（暂不支持搜索过滤）；经典模式按 domain 隔离
      const url = piMode
        ? `/api/assistant/sessions${query ? `?search=${encodeURIComponent(query)}` : ''}`
        : (() => {
            const params = new URLSearchParams();
            if (query) params.set('search', query);
            const agentId = agent ?? domain;
            if (agentId) params.set('agentId', agentId);
            return `/api/sessions${params.toString() ? `?${params.toString()}` : ''}`;
          })();
      const response = await apiFetch(url);
      if (response.ok) {
        const body = (await response.json()) as { sessions: SessionSummary[] };
        setSessions(body.sessions ?? []);
      }
    } catch {
      // 服务未就绪时保持现状
    }
  }, [sessionsSearch, domain, piMode]);

  useEffect(() => {
    apiFetch('/api/agents')
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
        const response = await apiFetch(
          piMode ? '/api/assistant/chat/stream' : `/api/agent/${domain}/chat/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId: activeSessionId }),
            signal: controller.signal,
          },
        );

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
                messageId: run.messageId,
                time: formatClock(new Date().toISOString()),
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
        [input, loading, domain, activeSessionId, piMode, patchMessage, loadSessions],
  );

  const newSession = useCallback(() => {
    setMessages([]);
    setActiveSessionId(undefined);
    setError(null);
  }, []);

  const switchDomain = (next: string) => {
    setDomain(next);
    newSession();
    // 切换 Agent 后加载该 Agent 的会话列表（按 agentId 隔离）
    void loadSessions(undefined, next);
  };

  const openSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(
        piMode
          ? `/api/assistant/sessions/${encodeURIComponent(sessionId)}`
          : `/api/sessions/${encodeURIComponent(sessionId)}`,
      );
      if (!response.ok) {
        throw new Error(`会话加载失败（${response.status}）`);
      }
      const body = (await response.json()) as {
        name: string;
        messages: {
          id?: number;
          question: string;
          answer: string;
          sql?: string;
          data?: Record<string, unknown>[];
          createdAt: string;
          feedback?: { rating: number; comment: string | null } | null;
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
          messageId: record.id,
          time: formatClock(record.createdAt),
          feedback: record.feedback?.rating === 1 ? 'up' : record.feedback?.rating === -1 ? 'down' : null,
        });
      }
      setMessages(items);
      setActiveSessionId(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '会话加载失败');
    } finally {
      setLoading(false);
    }
  }, [piMode]);

  const renameSession = useCallback(
    async (sessionId: string, name: string) => {
      await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
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
      const response = await apiFetch(
        piMode
          ? `/api/assistant/sessions/${encodeURIComponent(sessionId)}`
          : `/api/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      if (response.ok) {
        if (sessionId === activeSessionId) {
          setMessages([]);
          setActiveSessionId(undefined);
        }
        void loadSessions(sessionsSearch);
      }
    },
    [activeSessionId, loadSessions, sessionsSearch, piMode],
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

  /** 回答反馈：乐观更新 → 提交（next=null 表示取消，走 DELETE）；失败回滚并内联提示。 */
  const submitFeedback = useCallback(
    async (targetId: string, messageId: number | undefined, previous: FeedbackValue, next: FeedbackValue) => {
      patchMessage(targetId, { feedback: next });
      if (!messageId) {
        patchMessage(targetId, { feedback: previous });
        setError('该回答尚未落库，暂不能反馈');
        return;
      }
      if (!activeSessionId) {
        patchMessage(targetId, { feedback: previous });
        setError('会话尚未建立，请重试');
        return;
      }
      try {
        if (next === null) {
          const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(activeSessionId)}/messages/${messageId}/feedback`,
            { method: 'DELETE' },
          );
          if (!response.ok && response.status !== 404) {
            throw new Error(`取消反馈失败（${response.status}）`);
          }
        } else {
          const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(activeSessionId)}/messages/${messageId}/feedback`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rating: next === 'up' ? 1 : -1 }),
            },
          );
          if (!response.ok) {
            throw new Error(`反馈失败（${response.status}）`);
          }
        }
      } catch (err) {
        patchMessage(targetId, { feedback: previous });
        setError(err instanceof Error ? err.message : '反馈失败，请稍后重试');
      }
    },
    [activeSessionId, patchMessage],
  );

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
            <span className="meta">Pi 编排</span>
            <Switch checked={piMode} onChange={togglePiMode} />
            {activeSessionId ? <span className="meta">会话 {activeSessionId.slice(0, 8)}</span> : null}
            {messages.length > 0 ? (
              <Button type="link" size="small" onClick={newSession} disabled={loading}>
                清空会话
              </Button>
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
                  <Button key={example} size="small" onClick={() => void send(example)} disabled={loading}>
                    {example}
                  </Button>
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
                  {/* thinking 流：loading 时实时展示已收到的事件（类似 chat.qwen.ai） */}
                  {message.events && message.events.length > 0 ? (
                    <ThinkingStream events={message.events} loading={message.loading ?? false} />
                  ) : null}

                  {/* loading 且还没收到事件时，显示跳动点 */}
                  {message.loading && (!message.events || message.events.length === 0) ? (
                    <span className="chat-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : null}

                  {/* 非 loading 时显示回答内容 */}
                  {!message.loading ? (
                    <>
                      {message.content ? <Markdown content={message.content} /> : null}
                      {message.error ? (
                        <Button type="link" size="small" onClick={() => void retryLast()}>
                          重试
                        </Button>
                      ) : null}
                      {message.data && message.data.length > 0 ? (
                        <>
                          <ChatChart data={message.data} />
                          <ChatResultTable data={message.data} />
                        </>
                      ) : null}
                      {message.sql ? (
                        <div className="chat-details">
                          <Collapse
                            question="查看 SQL"
                            answer={<pre className="code">{message.sql}</pre>}
                          />
                        </div>
                      ) : null}
                      <div className="chat-bubble-actions">
                        <MessageActions
                          content={message.content}
                          copied={copiedId === message.id}
                          onCopy={() => void copyAnswer(message.id, message.content)}
                          rating={message.feedback ?? null}
                          messageId={message.messageId}
                          time={message.time}
                          onRate={(next) =>
                            void submitFeedback(message.id, message.messageId, message.feedback ?? null, next)
                          }
                        />
                      </div>
                    </>
                  ) : null}
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
            placeholder={`向${activeLabel}提问…`}
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
          <Button type="primary" loading={loading} onClick={() => void send()} disabled={!input.trim()}>
            发送
          </Button>
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

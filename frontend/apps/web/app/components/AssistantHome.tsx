'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Collapse } from './ui';
import type { AgentEvent, AgentRunResult } from '@pi-wren/shared-types';
import { apiFetch } from '../lib/api';
import ChatChart from '../chat/components/ChatChart';
import ChatResultTable from '../chat/components/ChatResultTable';
import SessionSidebar, { type SessionSummary } from '../chat/components/SessionSidebar';
import { ThinkingStream } from '../chat/components/ThinkingStream';
import { Markdown } from '../chat/components/Markdown';
import { MessageActions } from '../chat/components/MessageActions';
import { parseSseFrames, formatClock, type FeedbackValue } from '../chat/components/chat-utils';

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  data?: Record<string, unknown>[];
  events?: AgentEvent[];
  loading?: boolean;
  error?: boolean;
  messageId?: number;
  feedback?: FeedbackValue;
  /** 回答时间（HH:mm），动作行灰字展示。 */
  time?: string;
}

interface PanelItem {
  href: string;
  title: string;
  desc: string;
}

const EXAMPLES = [
  '各险种的赔付率如何？',
  '保费规模按险种分布？',
  '理赔案件的进度如何？',
  '近期保全业务有哪些？',
  '核保结果如何？',
];

const BASE_PANELS: PanelItem[] = [
  { href: '/query?m=contract', title: '契约查询', desc: '保单多条件组合查询' },
  { href: '/query?m=preserve', title: '保全查询', desc: '保全业务流水检索' },
  { href: '/query?m=claim', title: '理赔查询', desc: '理赔案件进度跟踪' },
  { href: '/chat', title: '经典问数', desc: '传统单 Agent 问数界面' },
];

const ADMIN_PANELS: PanelItem[] = [
  { href: '/agents', title: '自定义 Agent', desc: '注册/管理专属查询 Agent' },
  { href: '/users', title: '用户管理', desc: '账号、角色与机构分配' },
];

let homeMessageSeq = 0;
function nextMessageId(): string {
  homeMessageSeq += 1;
  return `home-${Date.now()}-${homeMessageSeq}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/**
 * 对话式首页（M3）：Pi 智能助手为核心入口。
 * 左侧会话列表（Pi 存储）+ 中央对话流 + 右侧功能面板（按角色显隐）；/chat 降级为经典问数。
 */
export default function AssistantHome() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsSearch, setSessionsSearch] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | 'anonymous'>('anonymous');
  const [displayName, setDisplayName] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 登录态与角色（功能面板按角色显隐）
  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((response) => response.json())
      .then((body: { enabled?: boolean; user?: { role: string; displayName: string } | null }) => {
        if (body.enabled === false) {
          setRole('anonymous'); // 未启用认证：全部可见（开发态）
        } else if (body.user) {
          setRole(body.user.role === 'admin' ? 'admin' : 'user');
          setDisplayName(body.user.displayName ?? '');
        } else {
          setRole('user');
        }
      })
      .catch(() => setRole('anonymous'));
  }, []);

  const loadSessions = useCallback(async (search?: string) => {
    const query = search ?? sessionsSearch;
    try {
      const url = `/api/assistant/sessions${query ? `?search=${encodeURIComponent(query)}` : ''}`;
      const response = await apiFetch(url);
      if (response.ok) {
        const body = (await response.json()) as {
          sessions: { id: string; name: string; updatedAt: string; turnCount?: number }[];
        };
        setSessions(
          (body.sessions ?? []).map((s) => ({
            sessionId: s.id,
            name: s.name,
            createdAt: s.updatedAt,
            updatedAt: s.updatedAt,
            messageCount: s.turnCount ?? 0,
          })),
        );
      }
    } catch {
      // 服务未就绪时保持现状
    }
  }, [sessionsSearch]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const panels = role === 'admin' || role === 'anonymous' ? [...BASE_PANELS, ...ADMIN_PANELS] : BASE_PANELS;
  const hasConversation = messages.length > 0;

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessageItem>) => {
    setMessages((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const send = useCallback(
    async (explicitMessage?: string) => {
      const message = (explicitMessage ?? input).trim();
      if (!message || loading) return;
      setLoading(true);
      setError(null);

      const userMessage: ChatMessageItem = { id: nextMessageId(), role: 'user', content: message };
      const assistantId = nextMessageId();
      setMessages((prev) => [
        ...prev,
        userMessage,
        { id: assistantId, role: 'assistant', content: '', loading: true },
      ]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      try {
        const response = await apiFetch('/api/assistant/chat/stream', {
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
                messageId: run.messageId ?? undefined,
                time: formatClock(new Date().toISOString()),
                loading: false,
              });
              setActiveSessionId(run.sessionId);
              void loadSessions();
            } else if (frame.event === 'error') {
              const payload = JSON.parse(frame.data) as { error?: string; label?: string };
              const detail = payload.error ?? payload.label ?? '执行失败';
              patchMessage(assistantId, { content: detail, error: true, loading: false });
              setError(detail);
            } else if (frame.event === 'answer_delta') {
              // token 级流式：增量拼接回答内容（done 帧会用最终全文覆盖）
              const { delta } = JSON.parse(frame.data) as { delta: string };
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === assistantId ? { ...item, content: (item.content ?? '') + delta } : item,
                ),
              );
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
            ? '请求超时（180 秒），请把问题拆小一些再试'
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
    [input, loading, activeSessionId, patchMessage, loadSessions],
  );

  const newSession = useCallback(() => {
    setMessages([]);
    setActiveSessionId(undefined);
    setError(null);
  }, []);

  const openSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/assistant/sessions/${encodeURIComponent(sessionId)}`);
      if (!response.ok) throw new Error(`会话加载失败（${response.status}）`);
      const body = (await response.json()) as {
        messages: { role: 'user' | 'assistant'; content: string; sql?: string; data?: Record<string, unknown>[]; at?: string }[];
      };
      setMessages(
        body.messages.map((m) => ({
          id: nextMessageId(),
          role: m.role,
          content: m.content,
          sql: m.sql,
          data: m.data,
          time: m.role === 'assistant' && m.at ? formatClock(m.at) : undefined,
        })),
      );
      setActiveSessionId(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '会话加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const response = await apiFetch(`/api/assistant/sessions/${encodeURIComponent(sessionId)}`, {
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
          if (!response.ok && response.status !== 404) throw new Error(`取消反馈失败（${response.status}）`);
        } else {
          const response = await apiFetch(
            `/api/sessions/${encodeURIComponent(activeSessionId)}/messages/${messageId}/feedback`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rating: next === 'up' ? 1 : -1 }),
            },
          );
          if (!response.ok) throw new Error(`反馈失败（${response.status}）`);
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

  /** 输入栏：落地态嵌在问候语下方（floating），对话态吸附底部（dock）；landing 时自动聚焦。 */
  const renderInput = (floating: boolean) => (
    <>
      <textarea
        ref={textareaRef}
        className="chat-textarea"
        placeholder="向企业数据提问…"
        value={input}
        rows={1}
        autoFocus={floating}
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
    </>
  );

  return (
    <div className="home-layout">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        search={sessionsSearch}
        onSearchChange={setSessionsSearch}
        onSelect={(sessionId) => void openSession(sessionId)}
        onNew={newSession}
        onDelete={(sessionId) => void deleteSession(sessionId)}
      />

      {hasConversation ? (
        <section className="home-main in-conversation">
          <div className="chat-messages">
            {messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="chat-row user">
                  <div className="chat-bubble user">{message.content}</div>
                </div>
              ) : (
                <div key={message.id} className="chat-row assistant">
                  <div className={`chat-bubble assistant${message.error ? ' error' : ''}`}>
                      {message.events && message.events.length > 0 ? (
                        <ThinkingStream events={message.events} loading={message.loading ?? false} />
                      ) : null}
                      {message.loading && !message.content ? (
                        <span className="chat-typing">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : null}
                      {/* 流式期间实时渲染增量内容；完成后渲染完整块（含动作行） */}
                      {message.content ? <Markdown content={message.content} /> : null}
                      {!message.loading ? (
                        <>
                          {message.error ? (
                          <Link href="/chat" className="meta" style={{ display: 'inline-block', marginTop: 6 }}>
                            智能助手不可用？去经典问数 →
                          </Link>
                        ) : null}
                        {message.data && message.data.length > 0 ? (
                          <>
                            <ChatChart data={message.data} />
                            <ChatResultTable data={message.data} />
                          </>
                        ) : null}
                        {message.sql ? (
                          <div className="chat-details">
                            <Collapse question="查看 SQL" answer={<pre className="code">{message.sql}</pre>} />
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
            {error && !messages.some((m) => m.loading) ? <div className="error-banner">{error}</div> : null}
            <div ref={messagesEndRef} />
          </div>

          <footer className="chat-input-bar">{renderInput(false)}</footer>
        </section>
      ) : (
        <section className="home-main">
          <div className="home-landing">
            <h1 className="home-greeting">
              {greeting()}{displayName ? `，${displayName}` : ''}
            </h1>
            <p className="home-tagline">我是你的企业数据助手，用自然语言提问，我来查数、做图、给结论。</p>
            <div className="home-input-floating">{renderInput(true)}</div>
          </div>
        </section>
      )}

      <aside className="home-rail">
        <div className="home-rail-title">功能面板</div>
        <div className="home-panels">
          {panels.map((panel) => (
            <Link key={panel.href + panel.title} href={panel.href} className="panel-card">
              <span className="panel-card-title">{panel.title}</span>
              <span className="panel-card-desc">{panel.desc}</span>
            </Link>
          ))}
        </div>
        {!hasConversation ? (
          <div className="home-examples">
            <div className="home-rail-title">试试这样问</div>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="home-example-chip"
                onClick={() => void send(example)}
                disabled={loading}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

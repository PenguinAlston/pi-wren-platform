'use client';

import { useState } from 'react';
import { relativeTime } from './chat-utils';

export interface SessionSummary {
  sessionId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface Props {
  sessions: SessionSummary[];
  activeSessionId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, name: string) => void;
  onDelete: (sessionId: string) => void;
}

/** 左侧会话栏（需求 4.2-1）：新建、搜索、历史会话列表、删除/重命名。 */
export default function SessionSidebar({
  sessions,
  activeSessionId,
  search,
  onSearchChange,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commitRename = (sessionId: string) => {
    const name = draft.trim();
    if (name) {
      onRename(sessionId, name);
    }
    setEditingId(null);
  };

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-head">
        <span className="chat-sidebar-title">会话</span>
        <button className="btn btn-secondary btn-sm" onClick={onNew}>
          ＋ 新建
        </button>
      </div>

      <input
        className="field-input chat-search"
        type="search"
        placeholder="搜索会话"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />

      <div className="chat-session-list">
        {sessions.length === 0 ? (
          <p className="meta chat-session-empty">暂无历史会话，点击「新建」开始提问</p>
        ) : (
          sessions.map((session) => {
            const active = session.sessionId === activeSessionId;
            return (
              <div
                key={session.sessionId}
                className={`chat-session-item${active ? ' active' : ''}`}
                onClick={() => onSelect(session.sessionId)}
              >
                {editingId === session.sessionId ? (
                  <input
                    className="field-input chat-rename-input"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitRename(session.sessionId);
                      } else if (e.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => commitRename(session.sessionId)}
                  />
                ) : (
                  <>
                    <div className="chat-session-name">{session.name}</div>
                    <div className="chat-session-meta">
                      {relativeTime(session.updatedAt)} · {session.messageCount} 轮
                    </div>
                    <div className="chat-session-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="link-btn"
                        title="重命名"
                        onClick={() => {
                          setEditingId(session.sessionId);
                          setDraft(session.name);
                        }}
                      >
                        重命名
                      </button>
                      <button
                        className="link-btn link-danger"
                        title="删除"
                        onClick={() => {
                          if (window.confirm(`删除会话「${session.name}」？`)) {
                            onDelete(session.sessionId);
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

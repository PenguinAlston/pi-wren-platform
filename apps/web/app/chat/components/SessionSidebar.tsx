'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Input, Modal } from 'animal-island-ui';
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

/** 左侧会话栏（需求 4.2-1）：新建、搜索、会话列表；末尾「⋯」菜单（重命名/删除，同 chat.qwen.ai）。 */
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SessionSummary | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部 / Esc 关闭菜单
  useEffect(() => {
    if (!menuOpenId) {
      return;
    }
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenId(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpenId]);

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
        <Button size="small" onClick={onNew}>
          新建
        </Button>
      </div>

      <Input
        type="search"
        allowClear
        className="chat-search"
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
                  <Input
                    className="chat-rename-input"
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
                  <div className="chat-session-row">
                    <div className="chat-session-info">
                      <div className="chat-session-name">{session.name}</div>
                      <div className="chat-session-meta">
                        {relativeTime(session.updatedAt)} · {session.messageCount} 轮
                      </div>
                    </div>

                    <Button
                      type="text"
                      size="small"
                      className="chat-session-dots"
                      aria-label="会话操作"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === session.sessionId ? null : session.sessionId);
                      }}
                    >
                      ⋯
                    </Button>

                    {menuOpenId === session.sessionId ? (
                      <div
                        className="chat-session-menu"
                        ref={menuRef}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="text"
                          block
                          size="small"
                          onClick={() => {
                            setEditingId(session.sessionId);
                            setDraft(session.name);
                            setMenuOpenId(null);
                          }}
                        >
                          重命名
                        </Button>
                        <Button
                          type="text"
                          danger
                          block
                          size="small"
                          onClick={() => {
                            setConfirmDelete(session);
                            setMenuOpenId(null);
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <Modal
        open={Boolean(confirmDelete)}
        title="删除会话"
        maskClosable
        onClose={() => setConfirmDelete(null)}
        onOk={() => {
          if (confirmDelete) {
            onDelete(confirmDelete.sessionId);
          }
          setConfirmDelete(null);
        }}
      >
        确认删除会话「{confirmDelete?.name}」？删除后不可恢复。
      </Modal>
    </aside>
  );
}

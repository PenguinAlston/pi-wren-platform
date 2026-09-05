'use client';

import { nextFeedback, type FeedbackValue } from './chat-utils';

/** 16px 线性图标（内联 SVG，currentColor 跟随按钮态）。 */
function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
  );
}

interface MessageActionsProps {
  content: string;
  copied: boolean;
  onCopy: () => void;
  rating: FeedbackValue;
  /** 缺失时赞/踩禁用（回答未落库）。 */
  messageId?: number;
  /** 点击后的新状态（同值再点为 null = 取消）；提交与回滚由父组件处理。 */
  onRate: (next: FeedbackValue) => void;
  /** 回答时间（HH:mm），灰字显示在动作行末尾。 */
  time?: string;
}

/** 回答动作行（chat.qwen.ai 风格）：复制 / 赞 / 踩线性图标 + 时间戳。 */
export function MessageActions({ content, copied, onCopy, rating, messageId, onRate, time }: MessageActionsProps) {
  return (
    <div className="message-actions">
      <button
        type="button"
        className="icon-btn"
        title={copied ? '已复制' : '复制'}
        disabled={!content}
        onClick={onCopy}
      >
        <CopyIcon />
      </button>
      <button
        type="button"
        className={`icon-btn${rating === 'up' ? ' active' : ''}`}
        title={messageId ? (rating === 'up' ? '取消赞' : '赞') : '该回答尚未落库，暂不能反馈'}
        disabled={!messageId}
        onClick={() => onRate(nextFeedback(rating, 'up'))}
      >
        <ThumbUpIcon />
      </button>
      <button
        type="button"
        className={`icon-btn${rating === 'down' ? ' active' : ''}`}
        title={messageId ? (rating === 'down' ? '取消踩' : '踩') : '该回答尚未落库，暂不能反馈'}
        disabled={!messageId}
        onClick={() => onRate(nextFeedback(rating, 'down'))}
      >
        <ThumbDownIcon />
      </button>
      {time ? <span className="message-time">{time}</span> : null}
    </div>
  );
}

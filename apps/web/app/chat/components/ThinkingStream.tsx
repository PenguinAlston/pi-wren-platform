'use client';

import { useEffect, useState } from 'react';
import type { AgentEvent, AgentEventType } from '@pi-wren/shared-types';

/** 事件类型标签（复用 TracePanel 的配色思路）。 */
const TYPE_META: Record<AgentEventType, { label: string; className: string }> = {
  plan: { label: '规划', className: 'think-badge plan' },
  tool_call: { label: '工具调用', className: 'think-badge tool' },
  tool_result: { label: '工具结果', className: 'think-badge tool' },
  observation: { label: '观察', className: 'think-badge obs' },
  answer: { label: '回答', className: 'think-badge ok' },
  error: { label: '错误', className: 'think-badge err' },
};

/**
 * 执行轨迹 thinking 流式展示（类似 chat.qwen.ai 的思考过程）。
 * - loading 中：自动展开，事件逐行实时出现
 * - loading 结束：自动折叠为"已思考 N 步"，点击可重新展开
 */
export function ThinkingStream({ events, loading }: { events: AgentEvent[]; loading: boolean }) {
  // loading 中默认展开；loading 结束后自动折叠
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!loading) {
      setExpanded(false);
    }
  }, [loading]);

  return (
    <div className="thinking-stream">
      <button
        type="button"
        className="thinking-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`thinking-dot${loading ? ' active' : ' done'}`} />
        <span className="thinking-title">
          {loading ? `思考中（${events.length}）` : `已思考 ${events.length} 步`}
        </span>
        <span className={`thinking-chevron${expanded ? ' open' : ''}`}>▾</span>
      </button>
      {expanded ? (
        <ol className="thinking-steps">
          {events.map((event) => {
            const meta = TYPE_META[event.type] ?? TYPE_META.observation;
            return (
              <li key={event.id} className="thinking-step">
                <span className={meta.className}>{meta.label}</span>
                <span className="thinking-label">{event.label}</span>
                {event.detail ? <pre className="thinking-detail">{event.detail}</pre> : null}
              </li>
            );
          })}
          {loading ? (
            <li className="thinking-step thinking-active">
              <span className="think-badge obs">···</span>
              <span className="thinking-pulse">正在处理</span>
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}

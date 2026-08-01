import type { AgentEvent, AgentEventType } from '@pi-wren/shared-types';

const TYPE_LABELS: Record<AgentEventType, { label: string; className: string }> = {
  plan: { label: '规划', className: 'badge-plan' },
  tool_call: { label: '工具调用', className: 'badge-tool' },
  tool_result: { label: '工具结果', className: 'badge-tool' },
  observation: { label: '观察', className: 'badge-obs' },
  answer: { label: '回答', className: 'badge-ok' },
  error: { label: '错误', className: 'badge-error' },
};

export function TracePanel({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) {
    return <p className="meta">暂无执行轨迹。</p>;
  }

  return (
    <ol style={{ margin: 0, paddingLeft: 20 }}>
      {events.map((event) => {
        const meta = TYPE_LABELS[event.type];
        return (
          <li key={event.id} style={{ marginBottom: 10 }}>
            <div>
              <span className={meta.className} style={badgeStyle}>
                {meta.label}
              </span>{' '}
              <strong>{event.label}</strong>
            </div>
            {event.detail ? (
              <pre className="code" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                {event.detail}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  padding: '1px 8px',
  borderRadius: 999,
  background: 'var(--code-bg)',
  color: 'var(--text-secondary)',
};

import type { AgentEvent, AgentRunResult } from '@pi-wren/shared-types';

/** SSE 响应头（Next/nginx 需关闭缓冲以保证流式）。 */
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** 将一次 Agent 执行事件序列化为 SSE 帧（事件名 = 事件类型）。 */
export function formatSseEvent(event: AgentEvent): string {
  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    label: event.label,
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
    timestamp: event.timestamp,
  });
  return `event: ${event.type}\ndata: ${payload}\n\n`;
}

/** 流结束帧：携带完整运行结果。 */
export function formatSseDone(result: AgentRunResult): string {
  return `event: done\ndata: ${JSON.stringify(result)}\n\n`;
}

/** 心跳帧（防止代理超时断开长连接）。 */
export function formatSseComment(comment = 'ping'): string {
  return `: ${comment}\n\n`;
}

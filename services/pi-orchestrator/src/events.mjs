import { randomUUID } from 'node:crypto';

/** 构造 UI 事件（与后端 AgentEvent 字段对齐：id/type/label/detail/timestamp）。 */
export function uiEvent(type, label, detail) {
  const event = { id: randomUUID(), type, label, timestamp: new Date().toISOString() };
  if (detail !== undefined && detail !== null) event.detail = String(detail).slice(0, 4000);
  return event;
}

/** 序列化 SSE 帧（\n\n 分帧，与前端 parseSseFrames 一致）。 */
export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * pi 事件 → UI 事件列表（0..n 条）。纯函数；state 由调用方持有用于统计与文本累积。
 * pi 0.83 事件字段做防御式提取（spike 确认存在 tool_execution_start/end、message_update）。
 */
export function mapPiEvent(e, state) {
  const out = [];
  if (e.type === 'tool_execution_start') {
    const name = e.toolName ?? e.tool?.name ?? e.name ?? 'tool';
    if (state) state.toolCallsStarted += 1;
    const input = e.args ?? e.input ?? e.params ?? {};
    out.push(uiEvent('tool_call', `调用工具 ${name}`, JSON.stringify(input)));
  } else if (e.type === 'tool_execution_end') {
    out.push(uiEvent('tool_result', '工具执行完成'));
  } else if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    if (state) state.text += e.assistantMessageEvent.delta ?? '';
  }
  return out;
}

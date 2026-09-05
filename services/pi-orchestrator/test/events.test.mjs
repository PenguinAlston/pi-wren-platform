import { describe, expect, it } from 'vitest';
import { mapPiEvent, sseFrame, uiEvent } from '../src/events.mjs';
import schema from '../protocol/events.schema.json' with { type: 'json' };

const UI_TYPES = schema.$defs.uiEvent.properties.type.enum;

describe('uiEvent', () => {
  it('字段齐全且 type 在协议内', () => {
    const e = uiEvent('plan', '理解问题', '各险种赔付率');
    expect(UI_TYPES).toContain(e.type);
    expect(e.id).toBeTruthy();
    expect(e.timestamp).toBeTruthy();
  });
  it('detail 截断到 4000', () => {
    const e = uiEvent('plan', 'x', 'a'.repeat(5000));
    expect(e.detail.length).toBe(4000);
  });
});

describe('sseFrame', () => {
  it('帧格式可被前端规则解析', () => {
    const frame = sseFrame('plan', { id: '1' });
    expect(frame).toMatch(/^event: plan\ndata: \{"id":"1"\}\n\n$/);
  });
});

describe('mapPiEvent', () => {
  it('tool_execution_start → tool_call 并计数', () => {
    const state = { toolCallsStarted: 0, text: '' };
    const events = mapPiEvent({ type: 'tool_execution_start', toolName: 'ask_data', args: { question: 'q' } }, state);
    expect(state.toolCallsStarted).toBe(1);
    expect(events[0].type).toBe('tool_call');
    expect(events[0].label).toContain('ask_data');
  });
  it('message_update text_delta 累积文本不发帧', () => {
    const state = { toolCallsStarted: 0, text: '' };
    const events = mapPiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你好' } }, state);
    expect(events).toHaveLength(0);
    expect(state.text).toBe('你好');
  });
  it('未知事件安全忽略', () => {
    expect(mapPiEvent({ type: 'mystery' }, { toolCallsStarted: 0, text: '' })).toHaveLength(0);
  });
});

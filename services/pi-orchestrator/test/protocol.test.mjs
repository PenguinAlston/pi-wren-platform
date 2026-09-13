import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { mapPiEvent, sseFrame, uiEvent } from '../src/events.mjs';
import schemaImport from '../protocol/events.schema.json' with { type: 'json' };

// 去掉 $schema 键（ajv8 默认 draft-07，2020-12 元标记会让 addSchema 报错；$defs/$ref 按指针解析不受影响）
const { $schema, ...schema } = schemaImport;

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema, 'events');
const vUiEvent = ajv.compile({ $ref: 'events#/$defs/uiEvent' });
const vDelta = ajv.compile({ $ref: 'events#/$defs/answerDelta' });
const vDone = ajv.compile({ $ref: 'events#/$defs/doneFrame' });

describe('事件协议契约（JSON Schema 自动校验）', () => {
  it('全部 UI 事件类型的真实产出均通过 schema', () => {
    const state = { toolCallsStarted: 0, text: '' };
    const produced = [
      uiEvent('plan', '理解问题', '各险种赔付率'),
      ...mapPiEvent({ type: 'tool_execution_start', toolName: 'ask_data', args: { question: 'q' } }, state),
      uiEvent('tool_result', '工具执行完成'),
      uiEvent('observation', '分析查询结果', '发现 3 条'),
      uiEvent('answer', '生成回答', '结论……'),
      uiEvent('error', '执行失败', 'timeout'),
    ];
    for (const event of produced) {
      expect(vUiEvent(event), JSON.stringify(vUiEvent.errors)).toBe(true);
    }
  });

  it('非法事件被 schema 拒绝（缺失必填/未知 type）', () => {
    expect(vUiEvent({ id: 'x', type: 'plan' })).toBe(false); // 缺 label/timestamp
    expect(vUiEvent({ id: 'x', type: 'mystery', label: 'x', timestamp: 't' })).toBe(false);
  });

  it('answer_delta 帧契约（F3 流式）', () => {
    expect(vDelta({ delta: '你好' })).toBe(true);
    expect(vDelta({})).toBe(false);
    const frame = sseFrame('answer_delta', { delta: '你好' });
    expect(frame).toContain('"delta":"你好"');
  });

  it('done 帧契约与后端 AgentRunResult 形状一致', () => {
    const done = {
      sessionId: 'abc', answer: 'A', sql: 'SELECT 1', data: [{ x: 1 }],
      events: [], toolCalls: [], durationMs: 12, messageId: 5, error: null,
    };
    expect(vDone(done), JSON.stringify(vDone.errors)).toBe(true);
    expect(vDone({ answer: '' })).toBe(false); // 缺 sessionId 等必填
  });
});

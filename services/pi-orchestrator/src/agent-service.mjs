import { mapPiEvent, uiEvent } from './events.mjs';
import { createGuardrails, withTimeout } from './guardrails.mjs';

const SYSTEM_PROMPT_BASE = [
  '你是企业数据智能平台的智能助手，用中文回答。',
  '职责：理解用户意图；涉及具体业务数据、数字、统计、清单的问题，必须调用 ask_data 工具，',
  '并根据工具返回的结果用自然语言转述与解读；禁止自行编造任何数值。',
  '与数据无关的问题（闲聊、概念解释、产品咨询）直接回答，不要调用工具。',
  '转述数据时保持与工具结果一致，不得改写、取整或推算。',
].join('');

function buildSystemPrompt(history) {
  if (!history.length) return SYSTEM_PROMPT_BASE;
  const lines = ['以下是本会话最近的对话记录（仅供参考）：'];
  for (const turn of history) {
    lines.push(`用户：${turn.question}`);
    lines.push(`助手：${turn.answer}`);
  }
  return `${lines.join('\n')}\n\n${SYSTEM_PROMPT_BASE}`;
}

/** 工具包装：超限时返回引导收尾的错误结果，不真调后端。 */
function guardToolCall(tool, guardrails) {
  return {
    ...tool,
    execute: async (id, params) => {
      if (!guardrails.registerToolCall()) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ok: false, error: '已达单次请求工具调用上限，请基于已有结果直接回答用户' }),
          }],
        };
      }
      return tool.execute(id, params);
    },
  };
}

/**
 * 一轮对话：历史注入 → Agent 循环（pi）→ 事件实时回调 → 持久化 → 汇总结果。
 * createAgent 注入：({ systemPrompt, model, tools, sessionId, onPiEvent }) =>
 *   { prompt(q), subscribe(fn), abort? }——生产用真 pi Agent，测试用 stub。
 */
export function createAgentService({ config, model, tools, store, createAgent }) {
  return {
    async run({ userKey, sessionId, question, onUiEvent }) {
      const guardrails = createGuardrails(config);
      const history = await store.history(userKey, sessionId, config.historyTurns);
      const state = { toolCallsStarted: 0, text: '' };
      const events = [];

      const push = (event) => {
        events.push(event);
        onUiEvent?.(event);
      };
      push(uiEvent('plan', '理解问题', question));

      const agent = createAgent({
        systemPrompt: buildSystemPrompt(history),
        model,
        tools: tools.map((tool) => guardToolCall(tool, guardrails)),
        sessionId,
        onPiEvent: (e) => {
          for (const event of mapPiEvent(e, state)) push(event);
        },
      });

      let failure = null;
      try {
        await withTimeout(agent.prompt(question), config.maxDurationMs, () => new Error('单次请求时长达到上限'));
      } catch (err) {
        failure = String(err?.message ?? err);
        push(uiEvent('error', failure.includes('时长') ? '执行超时' : '执行失败', failure));
      }

      let answer = state.text.trim();
      if (!answer) {
        answer = failure
          ? failure.includes('时长')
            ? '本次请求超时，请稍后重试，或把问题拆小一些再问。'
            : '本次处理失败，请稍后重试。'
          : '（未生成回答，请重试）';
      }
      push(uiEvent('answer', '生成回答', answer));

      await store.appendTurn(userKey, sessionId, {
        question,
        answer,
        at: new Date().toISOString(),
      });

      return { answer, events, durationMs: guardrails.elapsedMs, toolCalls: guardrails.toolCalls };
    },
  };
}

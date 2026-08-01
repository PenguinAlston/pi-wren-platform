import {
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
  shouldCompact,
  type AgentMessage,
  type CompactionSettings,
} from '@earendil-works/pi-agent-core';
import type { ConversationRecord } from '@pi-wren/agent-runtime';

export interface CompactionDecision {
  /** 是否建议触发上下文压缩。 */
  shouldCompact: boolean;
  /** 估算的上下文 token 数。 */
  contextTokens: number;
  /** 模型上下文窗口。 */
  contextWindow: number;
  /** 压缩阈值配置（来自 pi DEFAULT_COMPACTION_SETTINGS）。 */
  settings: CompactionSettings;
}

/** 将历史问答记录转换为 pi AgentMessage（用于 token 估算 / 上下文构建）。 */
export function recordsToMessages(records: ConversationRecord[]): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const record of records) {
    const timestamp = Date.parse(record.createdAt) || Date.now();
    messages.push({ role: 'user', content: record.question, timestamp });
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: record.answer }],
      api: 'openai-completions',
      provider: 'pi-bridge',
      model: 'conversation-history',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp,
    });
  }
  return messages;
}

/** 基于 pi 的字符启发式估算历史记录占用的 token。 */
export function estimateHistoryTokens(records: ConversationRecord[]): number {
  return recordsToMessages(records).reduce((sum, message) => sum + estimateTokens(message), 0);
}

/** 用 pi 的压缩决策函数判断当前历史是否超过阈值。 */
export function decideCompaction(
  records: ConversationRecord[],
  contextWindow = 32_768,
  settings: CompactionSettings = DEFAULT_COMPACTION_SETTINGS,
): CompactionDecision {
  const contextTokens = estimateHistoryTokens(records);
  return {
    shouldCompact: shouldCompact(contextTokens, contextWindow, settings),
    contextTokens,
    contextWindow,
    settings,
  };
}

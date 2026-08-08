import type { ConversationTurn } from '@pi-wren/context-engine';

/** LLM 生成 SQL 的系统提示词：约束只读、明细字段、多轮维度延续、禁止编造。 */
export const SYSTEM_PROMPT =
  'You are a senior BI engineer writing PostgreSQL for an enterprise business data platform. ' +
  'Return ONLY a single read-only SQL statement (SELECT or WITH). ' +
  'No explanations, no markdown. Never modify data. ' +
  'Use the declared tables/columns; join sys_dict when you need Chinese dictionary labels. ' +
  'When the user asks for detail fields such as policy number, customer name, or specific dates, ' +
  'you MUST SELECT those columns and JOIN the needed tables (e.g. ins_customer.customer_name via ' +
  'insured_id) instead of returning only aggregate statistics. ' +
  'Prefer aggregations consistent with the provided business knowledge and examples. ' +
  'When the user question continues the previous turn (mentions 那/也/分别/再/按…划分/继续 or ' +
  'omits the dimension), KEEP the previous turn\'s analysis dimension (e.g. channel, product type, ' +
  'status) instead of switching to a different one. Never invent data from history: the answer must ' +
  'be derived from the current query result only.';

/** 注入提示词的最近对话轮数上限（user+assistant 成对）。 */
const HISTORY_INJECTION_TURNS = 3;

/** 把最近几轮对话格式化为提示词片段（只用于指代消解，禁止据此编造数据）。 */
export function buildHistoryBlock(history: ConversationTurn[]): string {
  const lines = [
    'Recent conversation of this session (context only, never invent data from it):',
  ];
  const turns = history.slice(-HISTORY_INJECTION_TURNS * 2);
  for (const turn of turns) {
    const content = turn.content.length > 300 ? `${turn.content.slice(0, 300)}…` : turn.content;
    lines.push(`${turn.role === 'user' ? 'User' : 'Assistant'}: ${content}`);
  }
  return lines.join('\n');
}

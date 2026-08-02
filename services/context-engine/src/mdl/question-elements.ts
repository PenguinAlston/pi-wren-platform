/**
 * 问题要素抽取：把自然语言问题解析为可参与意图评分/参数渲染的结构化要素。
 * 供确定性意图匹配（config-context）与 LLM 提示词组织（agent-runtime）复用。
 */

export interface QuestionElements {
  /** 问题中出现的年份（20xx），如 ['2025'] */
  years: string[];
  hasYear: boolean;
  /** 用户要的是明细/名单（有哪些、明细、告诉我…姓名/保单号等） */
  wantsDetail: boolean;
  /** 用户要的是聚合统计（多少、数量、分布、占比、规模等） */
  wantsAggregate: boolean;
  /** 措辞包含"终止/已终止"（状态口径） */
  hasTerminatedWord: boolean;
  /** 措辞包含"到期/满期/续保"（日期口径） */
  hasExpiryWord: boolean;
}

const YEAR_RE = /\b(20\d{2})\b/g;

/** 明细类措辞：命中说明用户希望看到具体行（而不是只给汇总数字）。 */
const DETAIL_WORDS = [
  '哪些',
  '有哪些',
  '明细',
  '名单',
  '列表',
  '清单',
  '分别',
  '告诉我',
  '是什么',
  '列出',
  '保单号',
  '保单号码',
  '姓名',
  '号码',
  '编号',
];

/** 聚合类措辞：命中说明用户希望看到数量/占比/汇总。 */
const AGGREGATE_WORDS = [
  '多少',
  '数量',
  '统计',
  '分布',
  '占比',
  '平均',
  '合计',
  '汇总',
  '规模',
  '几个',
  '几条',
  '几笔',
];

/** 状态口径措辞（保单状态=已终止）。 */
const TERMINATED_WORDS = ['已终止', '终止'];

/** 日期口径措辞（终止/到期日期落在某年）。 */
const EXPIRY_WORDS = ['到期', '满期', '续保', '续期'];

/** 从问题中抽取结构化要素。 */
export function extractQuestionElements(question: string): QuestionElements {
  const years = [...question.matchAll(YEAR_RE)].map((m) => m[1] ?? '').filter(Boolean);
  return {
    years,
    hasYear: years.length > 0,
    wantsDetail: DETAIL_WORDS.some((w) => question.includes(w)),
    wantsAggregate: AGGREGATE_WORDS.some((w) => question.includes(w)),
    hasTerminatedWord: TERMINATED_WORDS.some((w) => question.includes(w)),
    hasExpiryWord: EXPIRY_WORDS.some((w) => question.includes(w)),
  };
}

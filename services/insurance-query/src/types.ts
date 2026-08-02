/** 传统查询模块（契约/保全/理赔）共享类型，对齐需求文档第 3 章。 */

export type QueryModule = 'contract' | 'preserve' | 'claim';

export interface Pagination {
  /** 页码，从 1 开始。 */
  page: number;
  /** 每页条数。 */
  pageSize: number;
}

export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  /** 排序列（白名单内键名，见 query-builder 的 *_SORT_COLUMNS）。 */
  sortBy?: string;
  sortOrder?: SortOrder;
}

/** 契约查询条件（需求 3.3.2）。 */
export interface ContractQueryConditions {
  /** 保单号，模糊匹配 */
  policyNo?: string;
  /** 险种类型（字典值） */
  productType?: string;
  /** 保单状态（字典值） */
  policyStatus?: string;
  /** 投保人姓名，模糊匹配 */
  applicantName?: string;
  /** 投保人证件号，模糊匹配 */
  applicantIdNo?: string;
  /** 被保人姓名，模糊匹配 */
  insuredName?: string;
  /** 被保人证件号，模糊匹配 */
  insuredIdNo?: string;
  /** 承保机构编码 */
  orgCode?: string;
  /** 投保渠道（字典值） */
  channelType?: string;
  /** 投保日期区间起（YYYY-MM-DD） */
  applyDateFrom?: string;
  /** 投保日期区间止（YYYY-MM-DD） */
  applyDateTo?: string;
  /** 年交保费下限 */
  premiumMin?: number;
  /** 年交保费上限 */
  premiumMax?: number;
}

/** 保全查询条件（需求 3.4.2）。 */
export interface PreserveQueryConditions {
  /** 保全单号，模糊匹配 */
  preserveId?: string;
  /** 关联保单号，模糊匹配 */
  policyId?: string;
  /** 保全类型（字典值） */
  preserveType?: string;
  /** 保全状态（字典值） */
  preserveStatus?: string;
  /** 申请人姓名，模糊匹配 */
  applicantName?: string;
  /** 申请时间区间起 */
  applyTimeFrom?: string;
  /** 申请时间区间止 */
  applyTimeTo?: string;
}

/** 理赔查询条件（需求 3.5.2）。 */
export interface ClaimQueryConditions {
  /** 理赔报案号，模糊匹配 */
  claimId?: string;
  /** 关联保单号，模糊匹配 */
  policyId?: string;
  /** 理赔类型（医疗理赔/重疾理赔/…，字典值） */
  claimType?: string;
  /** 理赔状态（字典值） */
  claimStatus?: string;
  /** 被保人姓名，模糊匹配 */
  insuredName?: string;
  /** 被保人证件号，模糊匹配 */
  insuredIdNo?: string;
  /** 报案时间区间起 */
  reportTimeFrom?: string;
  /** 报案时间区间止 */
  reportTimeTo?: string;
  /** 出险地区（省市区），模糊匹配 */
  accidentArea?: string;
  /** 实际赔付金额下限 */
  claimAmountMin?: number;
  /** 实际赔付金额上限 */
  claimAmountMax?: number;
}

export interface QueryPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DictItem {
  dictType: string;
  value: string;
  label: string;
  sortNum: number;
}

/** 契约详情（主表 + 附加险/受益人/缴费/核保）。 */
export interface ContractDetail {
  policy: Record<string, unknown>;
  riders: Record<string, unknown>[];
  benefits: Record<string, unknown>[];
  payLogs: Record<string, unknown>[];
  underwrite: Record<string, unknown>[];
}

/** 保全详情（主表 + 变更明细/费用/受益人/状态变更）。 */
export interface PreserveDetail {
  preserve: Record<string, unknown>;
  details: Record<string, unknown>[];
  fees: Record<string, unknown>[];
  benefits: Record<string, unknown>[];
  statusChanges: Record<string, unknown>[];
}

/** 理赔详情（主表 + 赔付明细/审核记录）。 */
export interface ClaimDetail {
  claim: Record<string, unknown>;
  payments: Record<string, unknown>[];
  audits: Record<string, unknown>[];
}

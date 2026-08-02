import type {
  ClaimQueryConditions,
  ContractQueryConditions,
  Pagination,
  PreserveQueryConditions,
  SortOption,
} from './types';

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

/** LIKE 模糊匹配参数转义：\ % _ 前缀反斜杠（配合 ESCAPE '\'），防通配符注入。 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * 参数化条件构建器：所有用户输入只出现在 $N 参数位，
 * 列名/表名来自下方白名单常量，杜绝 SQL 注入。
 */
class ConditionBuilder {
  private readonly clauses: string[] = [];
  private readonly params: unknown[] = [];

  /** 精确等值条件（空值跳过）。 */
  eq(column: string, value: unknown): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }
    this.params.push(value);
    this.clauses.push(`${column} = $${this.params.length}`);
    return this;
  }

  /** 区间下限（日期/数值）。 */
  gte(column: string, value: unknown, cast: 'date' | 'timestamp' | 'numeric'): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }
    this.params.push(value);
    this.clauses.push(`${column} >= $${this.params.length}::${cast}`);
    return this;
  }

  /** 区间上限（日期/数值）。 */
  lte(column: string, value: unknown, cast: 'date' | 'timestamp' | 'numeric'): this {
    if (value === undefined || value === null || value === '') {
      return this;
    }
    this.params.push(value);
    this.clauses.push(`${column} <= $${this.params.length}::${cast}`);
    return this;
  }

  /** 模糊匹配（LIKE，通配符已转义）。 */
  like(column: string, value: string | undefined): this {
    if (value === undefined || value.trim() === '') {
      return this;
    }
    this.params.push(escapeLike(value.trim()));
    this.clauses.push(`${column} LIKE '%' || $${this.params.length} || '%' ESCAPE '\\'`);
    return this;
  }

  build(
    select: string,
    defaultOrder: string,
    pagination: Pagination,
    sort: SortOption,
    sortColumns: Record<string, string>,
  ): BuiltQuery {
    const where = this.clauses.length > 0 ? `WHERE ${this.clauses.join(' AND ')}` : '';
    const orderBy = resolveOrderBy(defaultOrder, sort, sortColumns);
    const offset = (pagination.page - 1) * pagination.pageSize;
    const sql = `${select} ${where} ORDER BY ${orderBy} LIMIT ${pagination.pageSize} OFFSET ${offset}`;
    const countSql = `SELECT COUNT(*) AS total FROM (${select} ${where}) t`;
    return { sql, params: this.params, countSql, countParams: this.params };
  }
}

/** 排序白名单解析：未命中白名单的 sortBy 一律回退默认排序。 */
function resolveOrderBy(
  defaultOrder: string,
  sort: SortOption,
  sortColumns: Record<string, string>,
): string {
  const expr = sort.sortBy ? sortColumns[sort.sortBy] : undefined;
  if (!expr) {
    return defaultOrder;
  }
  const order = sort.sortOrder === 'asc' ? 'ASC' : 'DESC';
  return `${expr} ${order}`;
}

// ---------------------------------------------------------------------
// 契约查询（需求 3.3）
// ---------------------------------------------------------------------

const CONTRACT_SELECT = `
SELECT p.policy_id, p.policy_no, p.product_id, p.product_type, p.product_name,
       p.policy_status, ps.dict_label AS policy_status_label,
       p.pay_type, pt.dict_label AS pay_type_label, p.pay_year,
       p.year_premium, p.total_premium, p.total_amount,
       p.apply_date, p.effect_date, p.end_date,
       p.channel_type, pc.dict_label AS channel_label,
       p.org_code, o.org_name,
       a.customer_name AS applicant_name, a.id_no AS applicant_id_no, a.phone AS applicant_phone,
       i.customer_name AS insured_name, i.id_no AS insured_id_no, i.phone AS insured_phone
FROM ins_policy_main p
LEFT JOIN sys_dict ps ON ps.dict_type = 'policy_status' AND ps.dict_value = p.policy_status
LEFT JOIN sys_dict pt ON pt.dict_type = 'pay_type' AND pt.dict_value = p.pay_type
LEFT JOIN sys_dict pc ON pc.dict_type = 'channel_type' AND pc.dict_value = p.channel_type
LEFT JOIN sys_org o ON o.org_id = p.org_code
LEFT JOIN ins_customer a ON a.customer_id = p.applicant_id
LEFT JOIN ins_customer i ON i.customer_id = p.insured_id
`;

const CONTRACT_SORT_COLUMNS: Record<string, string> = {
  policyNo: 'p.policy_no',
  productType: 'p.product_type',
  policyStatus: 'p.policy_status',
  applyDate: 'p.apply_date',
  effectDate: 'p.effect_date',
  endDate: 'p.end_date',
  yearPremium: 'p.year_premium',
  totalPremium: 'p.total_premium',
  totalAmount: 'p.total_amount',
  payYear: 'p.pay_year',
  orgCode: 'p.org_code',
  channelType: 'p.channel_type',
  createTime: 'p.create_time',
};

export function buildContractQuery(
  conditions: ContractQueryConditions,
  pagination: Pagination,
  sort: SortOption,
): BuiltQuery {
  const b = new ConditionBuilder();
  b.like('p.policy_no', conditions.policyNo);
  b.eq('p.product_type', conditions.productType);
  b.eq('p.policy_status', conditions.policyStatus);
  b.like('a.customer_name', conditions.applicantName);
  b.like('a.id_no', conditions.applicantIdNo);
  b.like('i.customer_name', conditions.insuredName);
  b.like('i.id_no', conditions.insuredIdNo);
  b.eq('p.org_code', conditions.orgCode);
  b.eq('p.channel_type', conditions.channelType);
  b.gte('p.apply_date', conditions.applyDateFrom, 'date');
  b.lte('p.apply_date', conditions.applyDateTo, 'date');
  b.gte('p.year_premium', conditions.premiumMin, 'numeric');
  b.lte('p.year_premium', conditions.premiumMax, 'numeric');
  return b.build(
    CONTRACT_SELECT,
    'p.apply_date DESC, p.policy_id ASC',
    pagination,
    sort,
    CONTRACT_SORT_COLUMNS,
  );
}

// ---------------------------------------------------------------------
// 保全查询（需求 3.4）
// ---------------------------------------------------------------------

const PRESERVE_SELECT = `
SELECT m.preserve_id, m.policy_id,
       m.preserve_type, pt.dict_label AS preserve_type_label,
       m.preserve_status, ps.dict_label AS preserve_status_label,
       c.customer_name AS applicant_name,
       m.apply_time, m.audit_time, u.user_name AS audit_user_name,
       m.change_desc, m.org_code, o.org_name
FROM ins_preserve_main m
LEFT JOIN sys_dict pt ON pt.dict_type = 'preserve_type' AND pt.dict_value = m.preserve_type
LEFT JOIN sys_dict ps ON ps.dict_type = 'preserve_status' AND ps.dict_value = m.preserve_status
LEFT JOIN ins_customer c ON c.customer_id = m.apply_customer_id
LEFT JOIN sys_user u ON u.user_id = m.audit_user_id
LEFT JOIN sys_org o ON o.org_id = m.org_code
`;

const PRESERVE_SORT_COLUMNS: Record<string, string> = {
  preserveId: 'm.preserve_id',
  policyId: 'm.policy_id',
  preserveType: 'm.preserve_type',
  preserveStatus: 'm.preserve_status',
  applyTime: 'm.apply_time',
  auditTime: 'm.audit_time',
};

export function buildPreserveQuery(
  conditions: PreserveQueryConditions,
  pagination: Pagination,
  sort: SortOption,
): BuiltQuery {
  const b = new ConditionBuilder();
  b.like('m.preserve_id', conditions.preserveId);
  b.like('m.policy_id', conditions.policyId);
  b.eq('m.preserve_type', conditions.preserveType);
  b.eq('m.preserve_status', conditions.preserveStatus);
  b.like('c.customer_name', conditions.applicantName);
  b.gte('m.apply_time', conditions.applyTimeFrom, 'timestamp');
  b.lte('m.apply_time', conditions.applyTimeTo, 'timestamp');
  return b.build(
    PRESERVE_SELECT,
    'm.apply_time DESC, m.preserve_id ASC',
    pagination,
    sort,
    PRESERVE_SORT_COLUMNS,
  );
}

// ---------------------------------------------------------------------
// 理赔查询（需求 3.5）
// ---------------------------------------------------------------------

const CLAIM_SELECT = `
SELECT c.claim_id, c.policy_id,
       c.claim_type, c.claim_status, cs.dict_label AS claim_status_label,
       i.customer_name AS insured_name, i.id_no AS insured_id_no, i.phone AS insured_phone,
       c.accident_time, c.report_time, c.accident_area,
       c.apply_claim_amount, c.actual_claim_amount, c.close_time,
       c.org_code, o.org_name
FROM ins_claim_main c
LEFT JOIN sys_dict cs ON cs.dict_type = 'claim_status' AND cs.dict_value = c.claim_status
LEFT JOIN ins_customer i ON i.customer_id = c.insured_id
LEFT JOIN sys_org o ON o.org_id = c.org_code
`;

const CLAIM_SORT_COLUMNS: Record<string, string> = {
  claimId: 'c.claim_id',
  policyId: 'c.policy_id',
  claimType: 'c.claim_type',
  claimStatus: 'c.claim_status',
  reportTime: 'c.report_time',
  accidentTime: 'c.accident_time',
  closeTime: 'c.close_time',
  applyAmount: 'c.apply_claim_amount',
  actualAmount: 'c.actual_claim_amount',
};

export function buildClaimQuery(
  conditions: ClaimQueryConditions,
  pagination: Pagination,
  sort: SortOption,
): BuiltQuery {
  const b = new ConditionBuilder();
  b.like('c.claim_id', conditions.claimId);
  b.like('c.policy_id', conditions.policyId);
  b.eq('c.claim_type', conditions.claimType);
  b.eq('c.claim_status', conditions.claimStatus);
  b.like('i.customer_name', conditions.insuredName);
  b.like('i.id_no', conditions.insuredIdNo);
  b.gte('c.report_time', conditions.reportTimeFrom, 'timestamp');
  b.lte('c.report_time', conditions.reportTimeTo, 'timestamp');
  b.like('c.accident_area', conditions.accidentArea);
  b.gte('c.actual_claim_amount', conditions.claimAmountMin, 'numeric');
  b.lte('c.actual_claim_amount', conditions.claimAmountMax, 'numeric');
  return b.build(
    CLAIM_SELECT,
    'c.report_time DESC, c.claim_id ASC',
    pagination,
    sort,
    CLAIM_SORT_COLUMNS,
  );
}

// ---------------------------------------------------------------------
// 详情查询（需求 3.x 操作列「查看详情」）
// ---------------------------------------------------------------------

export const CONTRACT_DETAIL_SQL = `
SELECT p.*, ps.dict_label AS policy_status_label, pt.dict_label AS pay_type_label, pc.dict_label AS channel_label,
       o.org_name,
       a.customer_name AS applicant_name, a.id_no AS applicant_id_no, a.phone AS applicant_phone,
       a.address AS applicant_address,
       i.customer_name AS insured_name, i.id_no AS insured_id_no, i.phone AS insured_phone,
       i.address AS insured_address
FROM ins_policy_main p
LEFT JOIN sys_dict ps ON ps.dict_type = 'policy_status' AND ps.dict_value = p.policy_status
LEFT JOIN sys_dict pt ON pt.dict_type = 'pay_type' AND pt.dict_value = p.pay_type
LEFT JOIN sys_dict pc ON pc.dict_type = 'channel_type' AND pc.dict_value = p.channel_type
LEFT JOIN sys_org o ON o.org_id = p.org_code
LEFT JOIN ins_customer a ON a.customer_id = p.applicant_id
LEFT JOIN ins_customer i ON i.customer_id = p.insured_id
WHERE p.policy_id = $1
`;

export const CONTRACT_RIDERS_SQL = `
SELECT * FROM ins_policy_rider WHERE policy_id = $1 ORDER BY effect_date ASC
`;

export const CONTRACT_BENEFITS_SQL = `
SELECT b.*, c.customer_name, c.id_no AS customer_id_no, c.phone AS customer_phone
FROM ins_policy_benefit b
LEFT JOIN ins_customer c ON c.customer_id = b.customer_id
WHERE b.policy_id = $1
ORDER BY b.benefit_level ASC, b.benefit_rate DESC
`;

export const CONTRACT_PAY_LOGS_SQL = `
SELECT * FROM ins_policy_pay_log WHERE policy_id = $1 ORDER BY pay_period ASC
`;

export const CONTRACT_UNDERWRITE_SQL = `
SELECT * FROM ins_policy_underwrite WHERE policy_id = $1 ORDER BY underwrite_time ASC
`;

export const PRESERVE_DETAIL_SQL = `
SELECT m.*, pt.dict_label AS preserve_type_label, ps.dict_label AS preserve_status_label,
       c.customer_name AS applicant_name, c.id_no AS applicant_id_no, c.phone AS applicant_phone,
       u.user_name AS audit_user_name, o.org_name
FROM ins_preserve_main m
LEFT JOIN sys_dict pt ON pt.dict_type = 'preserve_type' AND pt.dict_value = m.preserve_type
LEFT JOIN sys_dict ps ON ps.dict_type = 'preserve_status' AND ps.dict_value = m.preserve_status
LEFT JOIN ins_customer c ON c.customer_id = m.apply_customer_id
LEFT JOIN sys_user u ON u.user_id = m.audit_user_id
LEFT JOIN sys_org o ON o.org_id = m.org_code
WHERE m.preserve_id = $1
`;

export const PRESERVE_DETAILS_SQL = `
SELECT * FROM ins_preserve_detail WHERE preserve_id = $1 ORDER BY change_time ASC
`;

export const PRESERVE_FEES_SQL = `
SELECT * FROM ins_preserve_fee WHERE preserve_id = $1
`;

export const PRESERVE_BENEFITS_SQL = `
SELECT b.*, c.customer_name, c.id_no AS customer_id_no, c.phone AS customer_phone
FROM ins_preserve_benefit b
LEFT JOIN ins_customer c ON c.customer_id = b.new_customer_id
WHERE b.preserve_id = $1
`;

export const PRESERVE_STATUS_CHANGES_SQL = `
SELECT * FROM ins_preserve_status WHERE preserve_id = $1 ORDER BY effect_time ASC
`;

export const CLAIM_DETAIL_SQL = `
SELECT c.*, cs.dict_label AS claim_status_label,
       i.customer_name AS insured_name, i.id_no AS insured_id_no, i.phone AS insured_phone,
       o.org_name
FROM ins_claim_main c
LEFT JOIN sys_dict cs ON cs.dict_type = 'claim_status' AND cs.dict_value = c.claim_status
LEFT JOIN ins_customer i ON i.customer_id = c.insured_id
LEFT JOIN sys_org o ON o.org_id = c.org_code
WHERE c.claim_id = $1
`;

export const CLAIM_PAYMENTS_SQL = `
SELECT * FROM ins_claim_pay WHERE claim_id = $1 ORDER BY pay_time ASC
`;

export const CLAIM_AUDITS_SQL = `
SELECT * FROM ins_claim_audit WHERE claim_id = $1 ORDER BY audit_time ASC
`;

/** 业务字典查询：全部启用字典，或按 dict_type 白名单过滤（前端下拉联动）。 */
export function buildDictQuery(dictTypes?: string[]): BuiltQuery {
  if (dictTypes && dictTypes.length > 0) {
    return {
      sql: `SELECT dict_type, dict_value, dict_label, sort_num FROM sys_dict
            WHERE status = '1' AND dict_type = ANY($1::text[])
            ORDER BY dict_type, sort_num`,
      params: [dictTypes],
      countSql: '',
      countParams: [],
    };
  }
  return {
    sql: `SELECT dict_type, dict_value, dict_label, sort_num FROM sys_dict
          WHERE status = '1' ORDER BY dict_type, sort_num`,
    params: [],
    countSql: '',
    countParams: [],
  };
}

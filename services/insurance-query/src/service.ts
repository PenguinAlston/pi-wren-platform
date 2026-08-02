import type { SqlExecutor } from '@pi-wren/data-engine';
import { maskRow } from './masking';
import {
  buildClaimQuery,
  buildContractQuery,
  buildDictQuery,
  buildPreserveQuery,
  CLAIM_AUDITS_SQL,
  CLAIM_DETAIL_SQL,
  CLAIM_PAYMENTS_SQL,
  CONTRACT_BENEFITS_SQL,
  CONTRACT_DETAIL_SQL,
  CONTRACT_PAY_LOGS_SQL,
  CONTRACT_RIDERS_SQL,
  CONTRACT_UNDERWRITE_SQL,
  PRESERVE_BENEFITS_SQL,
  PRESERVE_DETAIL_SQL,
  PRESERVE_DETAILS_SQL,
  PRESERVE_FEES_SQL,
  PRESERVE_STATUS_CHANGES_SQL,
  type BuiltQuery,
} from './query-builder';
import type {
  ClaimDetail,
  ClaimQueryConditions,
  ContractDetail,
  ContractQueryConditions,
  DictItem,
  Pagination,
  PreserveDetail,
  PreserveQueryConditions,
  QueryPage,
  SortOption,
} from './types';

/** 导出行数上限（与默认执行器 maxRows 对齐，避免海量结果灌入内存）。 */
export const MAX_EXPORT_ROWS = 1_000;

/**
 * 保险传统查询服务：契约/保全/理赔多条件组合查询、详情、导出、字典联动。
 * 所有查询参数化 + 列名白名单；结果在出口统一脱敏（需求 7.3）。
 */
export class InsuranceQueryService {
  constructor(private readonly sql: SqlExecutor) {}

  async queryContract(
    conditions: ContractQueryConditions,
    pagination: Pagination,
    sort: SortOption = {},
  ): Promise<QueryPage<Record<string, unknown>>> {
    return this.runList(buildContractQuery(conditions, pagination, sort), pagination);
  }

  async queryPreserve(
    conditions: PreserveQueryConditions,
    pagination: Pagination,
    sort: SortOption = {},
  ): Promise<QueryPage<Record<string, unknown>>> {
    return this.runList(buildPreserveQuery(conditions, pagination, sort), pagination);
  }

  async queryClaim(
    conditions: ClaimQueryConditions,
    pagination: Pagination,
    sort: SortOption = {},
  ): Promise<QueryPage<Record<string, unknown>>> {
    return this.runList(buildClaimQuery(conditions, pagination, sort), pagination);
  }

  /** 导出：不分页返回全部命中行（上限 MAX_EXPORT_ROWS），出口脱敏。 */
  async exportContract(
    conditions: ContractQueryConditions,
    sort: SortOption = {},
  ): Promise<Record<string, unknown>[]> {
    const built = buildContractQuery(conditions, { page: 1, pageSize: MAX_EXPORT_ROWS }, sort);
    const result = await this.sql.query(built.sql, built.params);
    return result.rows.map(maskRow);
  }

  /** 机构下拉（需求 3.3.2 承保机构：分公司/支公司/网点，来自 sys_org 与数据库联动）。 */
  async listOrgs(): Promise<{ orgId: string; orgName: string; orgLevel: string }[]> {
    const result = await this.sql.query(
      `SELECT org_id, org_name, org_level FROM sys_org WHERE status = '1' ORDER BY org_level, org_id`,
    );
    return result.rows.map((row) => ({
      orgId: String(row.org_id ?? ''),
      orgName: String(row.org_name ?? ''),
      orgLevel: String(row.org_level ?? ''),
    }));
  }

  async listDicts(dictTypes?: string[]): Promise<DictItem[]> {
    const built = buildDictQuery(dictTypes);
    const result = await this.sql.query(built.sql, built.params);
    return result.rows.map((row) => ({
      dictType: String(row.dict_type ?? ''),
      value: String(row.dict_value ?? ''),
      label: String(row.dict_label ?? ''),
      sortNum: Number(row.sort_num ?? 0),
    }));
  }

  async getContractDetail(policyId: string): Promise<ContractDetail | null> {
    const [policy, riders, benefits, payLogs, underwrite] = await Promise.all([
      this.sql.query(CONTRACT_DETAIL_SQL, [policyId]),
      this.sql.query(CONTRACT_RIDERS_SQL, [policyId]),
      this.sql.query(CONTRACT_BENEFITS_SQL, [policyId]),
      this.sql.query(CONTRACT_PAY_LOGS_SQL, [policyId]),
      this.sql.query(CONTRACT_UNDERWRITE_SQL, [policyId]),
    ]);
    const main = policy.rows[0];
    if (!main) {
      return null;
    }
    return {
      policy: maskRow(main),
      riders: riders.rows.map(maskRow),
      benefits: benefits.rows.map(maskRow),
      payLogs: payLogs.rows.map(maskRow),
      underwrite: underwrite.rows.map(maskRow),
    };
  }

  async getPreserveDetail(preserveId: string): Promise<PreserveDetail | null> {
    const [preserve, details, fees, benefits, statusChanges] = await Promise.all([
      this.sql.query(PRESERVE_DETAIL_SQL, [preserveId]),
      this.sql.query(PRESERVE_DETAILS_SQL, [preserveId]),
      this.sql.query(PRESERVE_FEES_SQL, [preserveId]),
      this.sql.query(PRESERVE_BENEFITS_SQL, [preserveId]),
      this.sql.query(PRESERVE_STATUS_CHANGES_SQL, [preserveId]),
    ]);
    const main = preserve.rows[0];
    if (!main) {
      return null;
    }
    return {
      preserve: maskRow(main),
      details: details.rows.map(maskRow),
      fees: fees.rows.map(maskRow),
      benefits: benefits.rows.map(maskRow),
      statusChanges: statusChanges.rows.map(maskRow),
    };
  }

  async getClaimDetail(claimId: string): Promise<ClaimDetail | null> {
    const [claim, payments, audits] = await Promise.all([
      this.sql.query(CLAIM_DETAIL_SQL, [claimId]),
      this.sql.query(CLAIM_PAYMENTS_SQL, [claimId]),
      this.sql.query(CLAIM_AUDITS_SQL, [claimId]),
    ]);
    const main = claim.rows[0];
    if (!main) {
      return null;
    }
    return {
      claim: maskRow(main),
      payments: payments.rows.map(maskRow),
      audits: audits.rows.map(maskRow),
    };
  }

  private async runList(
    built: BuiltQuery,
    pagination: Pagination,
  ): Promise<QueryPage<Record<string, unknown>>> {
    const [data, count] = await Promise.all([
      this.sql.query(built.sql, built.params),
      this.sql.query(built.countSql, built.countParams),
    ]);
    const totalRow = count.rows[0] as { total?: unknown } | undefined;
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.ceil(total / pagination.pageSize);
    return {
      items: data.rows.map(maskRow),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages,
    };
  }
}

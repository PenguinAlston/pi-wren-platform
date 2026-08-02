import { describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { QueryResult } from '@pi-wren/shared-types';
import { InsuranceQueryService, MAX_EXPORT_ROWS } from './service';

const policyRows: Record<string, unknown>[] = [
  {
    policy_no: 'P20240001',
    policy_status: '02',
    policy_status_label: '承保有效',
    applicant_id_no: '110101199001011234',
    applicant_phone: '13812345678',
    year_premium: 5200,
  },
  {
    policy_no: 'P20240002',
    policy_status: '01',
    policy_status_label: '待核保',
    applicant_id_no: '110101199202021234',
    applicant_phone: '13912345678',
    year_premium: 1800,
  },
];

function createFakeSql(overrides: Partial<Record<string, Record<string, unknown>[]>> = {}): SqlExecutor {
  const queries = vi.fn(async (sql: string): Promise<QueryResult> => {
    if (sql.includes('COUNT(*) AS total')) {
      return { rows: [{ total: 2 }], count: 1 };
    }
    if (sql.includes('ins_preserve_main')) {
      return { rows: overrides.preserve ?? [{ preserve_id: 'PRS0001', preserve_status_label: '已办结' }], count: 1 };
    }
    if (sql.includes('ins_claim_main')) {
      return { rows: overrides.claim ?? [{ claim_id: 'CLM0001', claim_status_label: '已结案' }], count: 1 };
    }
    if (sql.includes('ins_policy_rider')) {
      return { rows: [{ rider_id: 'RID0001' }], count: 1 };
    }
    return { rows: overrides.policy ?? policyRows, count: 2 };
  });
  return { query: queries };
}

describe('InsuranceQueryService', () => {
  it('queries contracts with pagination metadata and masks sensitive columns', async () => {
    const service = new InsuranceQueryService(createFakeSql());
    const result = await service.queryContract({ policyNo: 'P2024' }, { page: 1, pageSize: 10 });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(1);
    expect(result.items[0]?.applicant_id_no).toBe('110101********1234');
    expect(result.items[0]?.applicant_phone).toBe('138****5678');
    expect(result.items[0]?.policy_status_label).toBe('承保有效');
  });

  it('passes the built SQL and params to the executor', async () => {
    const sql = createFakeSql();
    const service = new InsuranceQueryService(sql);
    await service.queryContract({ productType: '01', premiumMin: 1000 }, { page: 2, pageSize: 20 });

    const calls = vi.mocked(sql.query).mock.calls;
    expect(calls.some(([query]) => query.includes('LIMIT 20 OFFSET 20'))).toBe(true);
    expect(calls.some(([query]) => query.includes('SELECT COUNT(*) AS total'))).toBe(true);
  });

  it('exports all matched rows without pagination offsets', async () => {
    const sql = createFakeSql();
    const service = new InsuranceQueryService(sql);
    const rows = await service.exportContract({});

    expect(rows).toHaveLength(2);
    expect(rows[0]?.applicant_id_no).toBe('110101********1234');
    const exportCall = vi.mocked(sql.query).mock.calls.find(([query]) => query.includes('LIMIT'));
    expect(exportCall?.[0]).toContain(`LIMIT ${MAX_EXPORT_ROWS} OFFSET 0`);
  });

  it('returns null detail when the main record is missing', async () => {
    const service = new InsuranceQueryService(createFakeSql({ policy: [] }));
    expect(await service.getContractDetail('POL-NOT-FOUND')).toBeNull();
  });

  it('returns contract detail with masked customer fields', async () => {
    const service = new InsuranceQueryService(createFakeSql());
    const detail = await service.getContractDetail('POL0001');

    expect(detail?.policy.policy_no).toBe('P20240001');
    expect(detail?.policy.applicant_id_no).toBe('110101********1234');
    expect(detail?.riders).toHaveLength(1);
  });

  it('returns preserve and claim details', async () => {
    const service = new InsuranceQueryService(createFakeSql());
    const preserve = await service.getPreserveDetail('PRS0001');
    expect(preserve?.preserve.preserve_id).toBe('PRS0001');
    expect(preserve?.details).toBeDefined();

    const claim = await service.getClaimDetail('CLM0001');
    expect(claim?.claim.claim_id).toBe('CLM0001');
    expect(claim?.payments).toBeDefined();
    expect(claim?.audits).toBeDefined();
  });

  it('lists dicts and maps rows to DictItem', async () => {
    const sql = createFakeSql({
      policy: [
        { dict_type: 'product_type', dict_value: '01', dict_label: '重疾险', sort_num: 1 },
        { dict_type: 'policy_status', dict_value: '02', dict_label: '承保有效', sort_num: 2 },
      ],
    });
    const service = new InsuranceQueryService(sql);
    const dicts = await service.listDicts(['product_type']);

    expect(dicts).toEqual([
      { dictType: 'product_type', value: '01', label: '重疾险', sortNum: 1 },
      { dictType: 'policy_status', value: '02', label: '承保有效', sortNum: 2 },
    ]);
    const call = vi.mocked(sql.query).mock.calls[0]?.[0] ?? '';
    expect(call).toContain('dict_type = ANY($1::text[])');
  });
});

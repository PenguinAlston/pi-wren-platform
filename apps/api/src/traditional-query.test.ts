import { afterAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { pino } from 'pino';
import { InsuranceQueryService } from '@pi-wren/insurance-query';
import type { SqlExecutor } from '@pi-wren/data-engine';
import type { QueryResult } from '@pi-wren/shared-types';
import { createApp } from './app';
import { loadConfig } from './config';
import type { ApiDeps } from './deps';

const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
const logger = pino({ level: 'silent' });

const policyRows: Record<string, unknown>[] = [
  {
    policy_no: 'P20240001',
    product_name: '康宁终身重疾险',
    policy_status_label: '承保有效',
    applicant_id_no: '110101199001011234',
    applicant_phone: '13812345678',
    year_premium: 5200,
  },
  {
    policy_no: 'P20240002',
    product_name: '惠民百万医疗险',
    policy_status_label: '待核保',
    applicant_id_no: '110101199202021234',
    applicant_phone: '13912345678',
    year_premium: 1800,
  },
];

const fakeSql: SqlExecutor = {
  async query(sql: string): Promise<QueryResult> {
    if (sql.includes('COUNT(*) AS total')) {
      return { rows: [{ total: 2 }], count: 1 };
    }
    if (sql.includes('ins_preserve_main')) {
      return {
        rows: [
          { preserve_id: 'PRS0001', policy_id: 'POL0001', preserve_status_label: '已办结', applicant_name: '张三' },
        ],
        count: 1,
      };
    }
    if (sql.includes('ins_claim_main')) {
      return {
        rows: [
          { claim_id: 'CLM0001', policy_id: 'POL0001', claim_status_label: '已结案', insured_name: '张三', actual_claim_amount: 200000 },
        ],
        count: 1,
      };
    }
    if (sql.includes('ins_policy_rider')) {
      return { rows: [{ rider_id: 'RID0001', rider_product_name: '住院医疗附加险' }], count: 1 };
    }
    if (sql.includes('ins_claim_pay')) {
      return { rows: [{ pay_id: 'CPY0001', pay_amount: 200000 }], count: 1 };
    }
    // 契约列表/详情/导出 SQL 同时包含 ins_policy_main 与 sys_dict JOIN，先匹配主表
    if (sql.includes('ins_policy_main')) {
      return { rows: policyRows, count: 2 };
    }
    if (sql.includes('sys_org')) {
      return {
        rows: [
          { org_id: 'ORG0101', org_name: '北京分公司', org_level: '2' },
          { org_id: 'ORG010101', org_name: '北京朝阳支公司', org_level: '3' },
        ],
        count: 2,
      };
    }
    if (sql.includes('sys_dict')) {
      return {
        rows: [
          { dict_type: 'product_type', dict_value: '01', dict_label: '重疾险', sort_num: 1 },
          { dict_type: 'product_type', dict_value: '02', dict_label: '医疗险', sort_num: 2 },
          { dict_type: 'policy_status', dict_value: '02', dict_label: '承保有效', sort_num: 2 },
        ],
        count: 3,
      };
    }
    return { rows: policyRows, count: 2 };
  },
};

const deps: ApiDeps = {
  config,
  logger,
  agents: [],
  query: new InsuranceQueryService(fakeSql),
};

const app = createApp(deps);
const server: Server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('traditional query api', () => {
  it('queries contracts with conditions, pagination and masking', async () => {
    const response = await postJson('/api/traditional/contract/query', {
      conditions: { policyNo: 'P2024', productType: '01' },
      page: 1,
      pageSize: 10,
      sortBy: 'yearPremium',
      sortOrder: 'desc',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Record<string, unknown>[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.totalPages).toBe(1);
    expect(body.items[0]?.applicant_id_no).toBe('110101********1234');
    expect(body.items[0]?.applicant_phone).toBe('138****5678');
    expect(body.items[0]?.policy_status_label).toBe('承保有效');
  });

  it('queries preserve records', async () => {
    const response = await postJson('/api/traditional/preserve/query', {
      conditions: { preserveStatus: '04' },
      page: 1,
      pageSize: 20,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { preserve_id: string }[] };
    expect(body.items[0]?.preserve_id).toBe('PRS0001');
  });

  it('queries claim records', async () => {
    const response = await postJson('/api/traditional/claim/query', {
      conditions: { claimStatus: '05', claimAmountMin: 10000 },
      page: 1,
      pageSize: 20,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { claim_id: string }[] };
    expect(body.items[0]?.claim_id).toBe('CLM0001');
  });

  it('rejects invalid date format with 400', async () => {
    const response = await postJson('/api/traditional/contract/query', {
      conditions: { applyDateFrom: '2024/01/01' },
      page: 1,
      pageSize: 10,
    });
    expect(response.status).toBe(400);
  });

  it('rejects invalid pagination with 400', async () => {
    const response = await postJson('/api/traditional/contract/query', {
      conditions: {},
      page: 0,
      pageSize: 999,
    });
    expect(response.status).toBe(400);
  });

  it('returns contract detail with masked customer fields', async () => {
    const response = await fetch(`${baseUrl}/api/traditional/contract/POL0001/detail`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      policy: Record<string, unknown>;
      riders: Record<string, unknown>[];
    };
    expect(body.policy.policy_no).toBe('P20240001');
    expect(body.policy.applicant_id_no).toBe('110101********1234');
    expect(body.riders).toHaveLength(1);
  });

  it('returns 404 for unknown contract detail', async () => {
    const sql: SqlExecutor = { query: async () => ({ rows: [], count: 0 }) };
    const app404 = createApp({
      config,
      logger,
      agents: [],
      query: new InsuranceQueryService(sql),
    });
    const server404 = app404.listen(0);
    const url = `http://127.0.0.1:${(server404.address() as { port: number }).port}`;
    try {
      const response = await fetch(`${url}/api/traditional/contract/NOPE/detail`);
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server404.close(() => resolve()));
    }
  });

  it('rejects path-traversal ids in detail route', async () => {
    const response = await fetch(`${baseUrl}/api/traditional/contract/..%2Fetc%2Fpasswd/detail`);
    expect(response.status).toBe(400);
  });

  it('exports contracts as UTF-8 CSV with masked values', async () => {
    const response = await postJson('/api/traditional/contract/export', { conditions: {} });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');

    // fetch().text() 按 WHATWG 规范会剥离前导 BOM，直接断言原始字节
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8').decode(bytes);
    expect(text).toContain('policy_no');
    expect(text).toContain('P20240001');
    expect(text).toContain('110101********1234');
  });

  it('returns orgs for dropdown linkage', async () => {
    const response = await fetch(`${baseUrl}/api/orgs`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { orgs: { orgId: string; orgName: string }[] };
    expect(body.orgs[0]).toEqual({ orgId: 'ORG0101', orgName: '北京分公司', orgLevel: '2' });
  });

  it('returns dicts grouped by type', async () => {
    const response = await fetch(`${baseUrl}/api/dicts?dictType=product_type,policy_status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      dicts: Record<string, { value: string; label: string }[]>;
    };
    expect(body.dicts.product_type).toEqual([
      { value: '01', label: '重疾险' },
      { value: '02', label: '医疗险' },
    ]);
    expect(body.dicts.policy_status?.[0]).toEqual({ value: '02', label: '承保有效' });
  });
});

import { describe, expect, it } from 'vitest';
import { buildClaimQuery, buildContractQuery, buildDictQuery, buildPreserveQuery, escapeLike } from './query-builder';

const pagination = { page: 2, pageSize: 20 };

describe('buildContractQuery', () => {
  it('combines all conditions with AND and parameterizes values', () => {
    const built = buildContractQuery(
      {
        policyNo: 'P2024',
        productType: '01',
        policyStatus: '02',
        applicantName: '张',
        applicantIdNo: '1101',
        insuredName: '李',
        insuredIdNo: '1102',
        orgCode: 'ORG0101',
        channelType: '02',
        applyDateFrom: '2024-01-01',
        applyDateTo: '2024-12-31',
        premiumMin: 1000,
        premiumMax: 10000,
      },
      pagination,
      { sortBy: 'yearPremium', sortOrder: 'asc' },
    );

    expect(built.sql).toContain('p.policy_no LIKE');
    expect(built.sql).toContain('p.product_type = $2');
    expect(built.sql).toContain("p.apply_date >= $10::date");
    expect(built.sql).toContain('p.year_premium <= $13::numeric');
    expect(built.sql).toContain('ORDER BY p.year_premium ASC');
    expect(built.sql).toContain('LIMIT 20 OFFSET 20');
    expect(built.params).toHaveLength(13);
    expect(built.countSql).toContain('SELECT COUNT(*) AS total');
  });

  it('escapes LIKE wildcards in fuzzy inputs', () => {
    const built = buildContractQuery({ policyNo: 'P%_1\\0' }, { page: 1, pageSize: 10 }, {});
    expect(built.params[0]).toBe('P\\%\\_1\\\\0');
    expect(built.sql).toContain("ESCAPE '\\'");
  });

  it('ignores unknown sortBy and falls back to default order', () => {
    const built = buildContractQuery({}, pagination, { sortBy: 'evil; drop table', sortOrder: 'asc' });
    expect(built.sql).toContain('ORDER BY p.apply_date DESC, p.policy_id ASC');
  });

  it('supports empty conditions (full scan with pagination)', () => {
    const built = buildContractQuery({}, { page: 1, pageSize: 50 }, {});
    expect(built.sql).toContain('FROM ins_policy_main p');
    expect(built.sql).not.toContain('WHERE');
    expect(built.params).toHaveLength(0);
  });
});

describe('buildPreserveQuery', () => {
  it('builds preserve query with type/status/time filters', () => {
    const built = buildPreserveQuery(
      { preserveId: 'PRS', preserveType: '03', preserveStatus: '04', applyTimeFrom: '2024-01-01' },
      pagination,
      {},
    );
    expect(built.sql).toContain('FROM ins_preserve_main m');
    expect(built.sql).toContain('m.preserve_type = $2');
    expect(built.sql).toContain('m.apply_time >= $4::timestamp');
    expect(built.sql).toContain('ORDER BY m.apply_time DESC, m.preserve_id ASC');
  });
});

describe('buildClaimQuery', () => {
  it('builds claim query with amount range and area fuzzy filter', () => {
    const built = buildClaimQuery(
      { claimId: 'CLM', claimType: '医疗理赔', claimStatus: '05', accidentArea: '北京', claimAmountMin: 10000 },
      pagination,
      { sortBy: 'actualAmount', sortOrder: 'desc' },
    );
    expect(built.sql).toContain('FROM ins_claim_main c');
    expect(built.sql).toContain("c.claim_type = $2");
    expect(built.sql).toContain('c.actual_claim_amount >= $5::numeric');
    expect(built.sql).toContain("c.accident_area LIKE");
    expect(built.sql).toContain('ORDER BY c.actual_claim_amount DESC');
  });
});

describe('buildDictQuery', () => {
  it('filters by dict types when provided', () => {
    const built = buildDictQuery(['product_type', 'policy_status']);
    expect(built.sql).toContain('dict_type = ANY($1::text[])');
    expect(built.params).toEqual([['product_type', 'policy_status']]);
  });

  it('lists all enabled dicts when no type filter', () => {
    const built = buildDictQuery();
    expect(built.sql).toContain("WHERE status = '1'");
    expect(built.params).toHaveLength(0);
  });
});

describe('escapeLike', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});

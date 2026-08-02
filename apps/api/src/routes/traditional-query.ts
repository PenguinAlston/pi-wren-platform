import { Router } from 'express';
import { z } from 'zod';
import type { InsuranceQueryService } from '@pi-wren/insurance-query';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式需为 YYYY-MM-DD');
const amountSchema = z.number().min(0);
const idSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'ID 只允许字母/数字/下划线/连字符');

const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(20),
});

const sortSchema = z.object({
  sortBy: z.string().trim().max(64).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/** 契约查询条件（需求 3.3.2）。 */
const contractConditionsSchema = z.object({
  policyNo: z.string().trim().max(64).optional(),
  productType: z.string().trim().max(32).optional(),
  policyStatus: z.string().trim().max(16).optional(),
  applicantName: z.string().trim().max(50).optional(),
  applicantIdNo: z.string().trim().max(32).optional(),
  insuredName: z.string().trim().max(50).optional(),
  insuredIdNo: z.string().trim().max(32).optional(),
  orgCode: z.string().trim().max(64).optional(),
  channelType: z.string().trim().max(32).optional(),
  applyDateFrom: dateSchema.optional(),
  applyDateTo: dateSchema.optional(),
  premiumMin: amountSchema.optional(),
  premiumMax: amountSchema.optional(),
});

/** 保全查询条件（需求 3.4.2）。 */
const preserveConditionsSchema = z.object({
  preserveId: z.string().trim().max(64).optional(),
  policyId: z.string().trim().max(64).optional(),
  preserveType: z.string().trim().max(32).optional(),
  preserveStatus: z.string().trim().max(16).optional(),
  applicantName: z.string().trim().max(50).optional(),
  applyTimeFrom: dateSchema.optional(),
  applyTimeTo: dateSchema.optional(),
});

/** 理赔查询条件（需求 3.5.2）。 */
const claimConditionsSchema = z.object({
  claimId: z.string().trim().max(64).optional(),
  policyId: z.string().trim().max(64).optional(),
  claimType: z.string().trim().max(32).optional(),
  claimStatus: z.string().trim().max(16).optional(),
  insuredName: z.string().trim().max(50).optional(),
  insuredIdNo: z.string().trim().max(32).optional(),
  reportTimeFrom: dateSchema.optional(),
  reportTimeTo: dateSchema.optional(),
  accidentArea: z.string().trim().max(128).optional(),
  claimAmountMin: amountSchema.optional(),
  claimAmountMax: amountSchema.optional(),
});

const contractQuerySchema = z.object({
  conditions: contractConditionsSchema.default({}),
  ...paginationSchema.shape,
  ...sortSchema.shape,
});

const preserveQuerySchema = z.object({
  conditions: preserveConditionsSchema.default({}),
  ...paginationSchema.shape,
  ...sortSchema.shape,
});

const claimQuerySchema = z.object({
  conditions: claimConditionsSchema.default({}),
  ...paginationSchema.shape,
  ...sortSchema.shape,
});

const contractExportSchema = z.object({
  conditions: contractConditionsSchema.default({}),
  ...sortSchema.shape,
});

/** CSV 序列化：字段按首行键顺序，特殊字符加引号转义。 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return '';
  }
  const headers = Object.keys(rows[0] ?? {});
  const escapeCell = (value: unknown): string => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(','));
  }
  return lines.join('\n');
}

/** 传统查询路由：契约/保全/理赔 查询 + 详情 + 导出（需求第 3 章）。 */
export function createTraditionalQueryRouter(query: InsuranceQueryService): Router {
  const router = Router();

  router.post('/contract/query', async (req, res) => {
    const parsed = contractQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    const { conditions, page, pageSize, sortBy, sortOrder } = parsed.data;
    const result = await query.queryContract(conditions, { page, pageSize }, { sortBy, sortOrder });
    res.json(result);
  });

  router.post('/preserve/query', async (req, res) => {
    const parsed = preserveQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    const { conditions, page, pageSize, sortBy, sortOrder } = parsed.data;
    const result = await query.queryPreserve(conditions, { page, pageSize }, { sortBy, sortOrder });
    res.json(result);
  });

  router.post('/claim/query', async (req, res) => {
    const parsed = claimQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    const { conditions, page, pageSize, sortBy, sortOrder } = parsed.data;
    const result = await query.queryClaim(conditions, { page, pageSize }, { sortBy, sortOrder });
    res.json(result);
  });

  router.get('/contract/:policyId/detail', async (req, res) => {
    const policyId = req.params.policyId ?? '';
    if (!idSchema.safeParse(policyId).success) {
      res.status(400).json({ error: 'invalid policyId' });
      return;
    }
    const detail = await query.getContractDetail(policyId);
    if (!detail) {
      res.status(404).json({ error: 'policy not found' });
      return;
    }
    res.json(detail);
  });

  router.get('/preserve/:preserveId/detail', async (req, res) => {
    const preserveId = req.params.preserveId ?? '';
    if (!idSchema.safeParse(preserveId).success) {
      res.status(400).json({ error: 'invalid preserveId' });
      return;
    }
    const detail = await query.getPreserveDetail(preserveId);
    if (!detail) {
      res.status(404).json({ error: 'preserve not found' });
      return;
    }
    res.json(detail);
  });

  router.get('/claim/:claimId/detail', async (req, res) => {
    const claimId = req.params.claimId ?? '';
    if (!idSchema.safeParse(claimId).success) {
      res.status(400).json({ error: 'invalid claimId' });
      return;
    }
    const detail = await query.getClaimDetail(claimId);
    if (!detail) {
      res.status(404).json({ error: 'claim not found' });
      return;
    }
    res.json(detail);
  });

  router.post('/contract/export', async (req, res) => {
    const parsed = contractExportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request', details: parsed.error.flatten() });
      return;
    }
    const { conditions, sortBy, sortOrder } = parsed.data;
    const rows = await query.exportContract(conditions, { sortBy, sortOrder });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="contract-export-${Date.now()}.csv"`);
    // BOM 保证 Excel 正确识别 UTF-8 中文
    res.send(`\uFEFF${toCsv(rows)}`);
  });

  return router;
}

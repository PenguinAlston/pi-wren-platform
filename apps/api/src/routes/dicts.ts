import { Router } from 'express';
import type { InsuranceQueryService } from '@pi-wren/insurance-query';

/** 机构接口：GET /api/orgs（承保机构下拉，需求 3.3.2）。 */
export function createOrgsRouter(query: InsuranceQueryService): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const orgs = await query.listOrgs();
    res.json({ orgs });
  });

  return router;
}

/** 业务字典接口：GET /api/dicts?dictType=product_type,policy_status（前端下拉联动，需求 3.2）。 */
export function createDictsRouter(query: InsuranceQueryService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const raw = typeof req.query.dictType === 'string' ? req.query.dictType : undefined;
    const dictTypes = raw
      ? raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 20)
      : undefined;

    const items = await query.listDicts(dictTypes);
    const dicts: Record<string, { value: string; label: string }[]> = {};
    for (const item of items) {
      (dicts[item.dictType] ??= []).push({ value: item.value, label: item.label });
    }
    res.json({ dicts });
  });

  return router;
}

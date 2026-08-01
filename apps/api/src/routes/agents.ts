import type { Request, Response } from 'express';
import type { ApiDeps } from '../deps';

export function createAgentsHandler(deps: ApiDeps) {
  return (_req: Request, res: Response) => {
    res.json({
      agents: deps.agents.map((spec) => ({
        id: spec.id,
        label: spec.label,
        description: spec.description,
        metrics: spec.metrics,
      })),
    });
  };
}

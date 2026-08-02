import type { Request, Response } from 'express';
import type { ApiDeps } from '../deps';

export function createAgentsHandler(deps: ApiDeps) {
  return (_req: Request, res: Response) => {
    // builtin 来自代码注册；自定义 Agent 从注册表动态读取（支持运行时新增）
    const all = [
      ...deps.agents.filter((spec) => spec.source === 'builtin'),
      ...(deps.customAgents?.list() ?? []),
    ];
    res.json({
      agents: all.map((spec) => ({
        id: spec.id,
        label: spec.label,
        description: spec.description,
        metrics: spec.metrics,
        source: spec.source,
      })),
    });
  };
}

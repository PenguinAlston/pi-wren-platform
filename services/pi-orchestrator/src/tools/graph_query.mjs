import { Type } from "@earendil-works/pi-ai";
import { createInternalClient } from "./_internal_client.mjs";

function textPayload(payload) {
  return { type: "text", text: JSON.stringify(payload) };
}

function textResult(payload, details = {}) {
  return {
    content: [textPayload(payload)],
    details,
  };
}

/**
 * graph_query 工具：知识图谱概览与节点邻居探索（Apache AGE）。
 * 与 ask_data 分工：图谱管"实体之间关联关系"，统计数字仍走 ask_data。
 */
export function createGraphQueryTool({
  backendUrl,
  internalToken,
  identityHeaders = {},
  timeoutMs = 120_000,
  fetchImpl = fetch,
}) {
  const client = createInternalClient({ backendUrl, internalToken, identityHeaders, timeoutMs, fetchImpl });
  return {
    name: "graph_query",
    label: "知识图谱查询",
    description:
      "查询知识图谱：实体关联关系探索。" +
      "action=overview 返回全图规模统计（各类节点/关系数量）；" +
      "action=neighbors 返回指定节点的一跳关联子图，需提供 label" +
      "（枚举：Org机构/SysUser员工/Product产品/Customer客户/Policy保单/Claim理赔/Preserve保全）和 gid（业务实体 ID，可从 overview 或之前的查询结果获得）。" +
      "当用户问『X 和 Y 有什么关系』『某保单/客户关联了什么』这类关系问题时使用；统计数字请用 ask_data。",
    parameters: Type.Object({
      action: Type.String({ description: "overview | neighbors" }),
      label: Type.Optional(Type.String({ description: "neighbors 必填：节点类型枚举" })),
      gid: Type.Optional(Type.String({ description: "neighbors 必填：节点业务 ID" })),
    }),
    execute: async (_id, params) => {
      if (params.action === "overview") {
        const result = await client("/internal/graph/overview");
        const d = result.data ?? {};
        if (!result.ok) {
          return textResult({ ok: false, error: d.error ?? `backend ${result.status}` });
        }
        return {
          content: [textPayload({
            ok: true,
            stats: d.stats ?? null,
            categories: d.categories ?? [],
            hint: "要探索某个节点的关联，用 action=neighbors 并提供 label 与 gid",
          })],
          details: { nodes: d.nodes ?? [], edges: d.edges ?? [] },
        };
      }
      if (params.action === "neighbors") {
        if (!params.label || !params.gid) {
          return textResult({ ok: false, error: "neighbors 需要 label 与 gid 参数" });
        }
        const query = `?label=${encodeURIComponent(params.label)}&gid=${encodeURIComponent(params.gid)}`;
        const result = await client(`/internal/graph/neighbors${query}`);
        const d = result.data ?? {};
        if (!result.ok) {
          return textResult({ ok: false, error: d.error ?? `backend ${result.status}` });
        }
        const nodes = Array.isArray(d.nodes) ? d.nodes : [];
        const edges = Array.isArray(d.edges) ? d.edges : [];
        const relations = edges.map((e) => `${e.source} -[${e.relation}]-> ${e.target}`);
        return {
          content: [textPayload({
            ok: true,
            center: params.gid,
            nodeCount: nodes.length,
            edgeCount: edges.length,
            nodes: nodes.slice(0, 20).map((n) => ({ label: n.label, name: n.name, gid: n.props?.gid ?? null })),
            relations: relations.slice(0, 30),
          })],
          details: { nodes, edges },
        };
      }
      return textResult({ ok: false, error: `未知 action: ${params.action}（overview | neighbors）` });
    },
  };
}

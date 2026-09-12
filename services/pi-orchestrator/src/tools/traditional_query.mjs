import { Type } from "@earendil-works/pi-ai";
import { createInternalClient } from "./_internal_client.mjs";

function textResult(payload, details = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details,
  };
}

/**
 * traditional_query 工具：契约/保全/理赔的结构化列表查询（参数化 SQL，不走 NL2SQL）。
 * 与 ask_data 的分工：ask_data 管"统计/汇总/占比/排名"，本工具管"要某一模块的明细清单"。
 */
export function createTraditionalQueryTool({
  backendUrl,
  internalToken,
  identityHeaders = {},
  timeoutMs = 120_000,
  sampleRowLimit = 10,
  fetchImpl = fetch,
}) {
  const client = createInternalClient({ backendUrl, internalToken, identityHeaders, timeoutMs, fetchImpl });
  return {
    name: "traditional_query",
    label: "业务清单查询",
    description:
      "按模块查询业务明细清单（参数化 SQL，非自然语言统计）。" +
      "module 取值：contract=保单契约、preserve=保全、claim=理赔。" +
      "conditions 为可选过滤对象，常用键：保单号 policyNo、客户名 customerName、状态 status、日期区间等，" +
      "不确定字段名时可省略 conditions 查第一页。" +
      "当用户要查看某类业务的明细清单/列表时使用本工具；统计汇总类问题请改用 ask_data。",
    parameters: Type.Object({
      module: Type.String({ description: "模块：contract | preserve | claim" }),
      conditions: Type.Optional(
        Type.Object({}, { description: "过滤条件键值对，可省略" }),
      ),
      page: Type.Optional(Type.Number({ description: "页码，默认 1" })),
      pageSize: Type.Optional(Type.Number({ description: "每页条数，默认 10，最大 100" })),
    }),
    execute: async (_id, params) => {
      const query = `?module=${encodeURIComponent(params.module)}`;
      const body = {
        conditions: params.conditions ?? {},
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 10,
      };
      const result = await client(`/internal/traditional/query${query}`, { method: "POST", body });
      const d = result.data ?? {};
      if (!result.ok) {
        return textResult({ ok: false, module: params.module, error: d.error ?? `backend ${result.status}` });
      }
      const rows = Array.isArray(d.items) ? d.items : [];
      return {
        content: [textPayload({
          ok: true,
          module: params.module,
          total: d.total ?? rows.length,
          page: d.page ?? body.page,
          totalPages: d.totalPages ?? null,
          rowCount: rows.length,
          sampleRows: rows.slice(0, sampleRowLimit),
        })],
        details: { rows, rowCount: rows.length, module: params.module },
      };
    },
  };
}

function textPayload(payload) {
  return { type: "text", text: JSON.stringify(payload) };
}

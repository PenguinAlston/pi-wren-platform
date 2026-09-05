import { Type } from '@earendil-works/pi-ai';

function textResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/**
 * ask_data 工具：问数请求转 Python /internal/agent/insurance/chat（WrenAI 治理流水线）。
 * fetchImpl 注入便于测试；120s 超时与 spec §5 一致。
 */
export function createAskDataTool({
  backendUrl,
  internalToken,
  timeoutMs = 120_000,
  sampleRowLimit = 10,
  fetchImpl = fetch,
  identityHeaders = {},
}) {
  return {
    name: 'ask_data',
    label: '企业数据查询',
    description:
      '对保险业务数据（保单/理赔/保全/客户/产品等）做自然语言查询，返回统计结果与明细。' +
      '凡涉及具体业务数据、数字、统计、清单的问题，必须调用本工具，禁止自行编造数值。',
    parameters: Type.Object({
      question: Type.String({ description: '用户的业务数据问题，原样转述，不要改写' }),
    }),
    execute: async (_id, params) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${backendUrl}/internal/agent/insurance/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken, ...identityHeaders },
          body: JSON.stringify({ message: params.question }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          return textResult({ ok: false, error: body.error ?? `backend ${response.status}` });
        }
        const rows = Array.isArray(body.data) ? body.data : [];
        return textResult({
          ok: !body.error,
          answer: body.answer ?? '',
          sql: body.sql ?? null,
          rowCount: rows.length,
          sampleRows: rows.slice(0, sampleRowLimit),
          error: body.error ?? null,
        });
      } catch (err) {
        const message = err?.name === 'AbortError' ? '查询超时' : String(err?.message ?? err);
        return textResult({ ok: false, error: message });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

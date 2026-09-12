/** internal 接口客户端：统一 token/身份头/超时/错误包裹（各工具共用）。 */
export function createInternalClient({
  backendUrl,
  internalToken,
  identityHeaders = {},
  timeoutMs = 120_000,
  fetchImpl = fetch,
}) {
  return async function callInternal(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${backendUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": internalToken,
          ...identityHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, status: response.status, data: { error: data.error ?? `backend ${response.status}` } };
      }
      return { ok: true, status: response.status, data };
    } catch (err) {
      const message = err?.name === "AbortError" ? "查询超时" : String(err?.message ?? err);
      return { ok: false, status: 0, data: { error: message } };
    } finally {
      clearTimeout(timer);
    }
  };
}

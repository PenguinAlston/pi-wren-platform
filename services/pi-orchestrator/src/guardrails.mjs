/** 单次请求护栏：工具调用次数 + 总时长（spec §5）。 */
export function createGuardrails({ maxToolCalls = 8, maxDurationMs = 175_000 } = {}) {
  const startedAt = Date.now();
  let toolCalls = 0;
  return {
    get toolCalls() {
      return toolCalls;
    },
    /** 工具调用前登记；超限返回 false（工具应返回引导收尾的错误结果）。 */
    registerToolCall() {
      toolCalls += 1;
      return toolCalls <= maxToolCalls;
    },
    get expired() {
      return Date.now() - startedAt >= maxDurationMs;
    },
    get elapsedMs() {
      return Date.now() - startedAt;
    },
  };
}

/** Promise 超时包装；超时以 createError() 的错误 reject。 */
export function withTimeout(promise, ms, createError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

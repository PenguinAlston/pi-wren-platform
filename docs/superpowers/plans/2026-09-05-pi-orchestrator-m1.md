# Pi 编排底座 M1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 M1——Pi（Node sidecar）编排底座跑通：ask_data 工具走现有 WrenAI 问数流水线，Python 代理鉴权/限流/熔断，/chat 页加灰度开关端到端可用。

**Architecture:** 独立 Node 服务 `services/pi-orchestrator`（pi-agent-core 0.83.0，仅内网）持有 Agent 循环与工具；工具 = 对 Python `/internal/*` 的受控 HTTP 调用；Python 新增 `/api/assistant/*` 代理（SSE 透传 + 熔断）与 `/internal/agent/{domain}/chat`（internal token + 身份反查权限）；前端 /chat 加 Pi 模式开关复用现有渲染。

**Tech Stack:** Node ≥22.19（ESM，无构建步骤，vitest）、FastAPI + httpx 流式代理、Next.js。

**Spec:** `docs/superpowers/specs/2026-09-05-pi-orchestrator-design.md`

**M1 范围裁决（按 spec 推荐口径执行）：**
- 会话持久化：自实现 JSONL store（spec 的"jsonl 落卷、repo 可插拔"意图），pi 内置 session repo 探索推迟到 M4
- 熔断：失败计数熔断（连续 3 次连接失败打开 30s，成功复位，超时自然半开），替代独立健康探测——行为等价、实现更简单
- UI 事件：M1 不发文本增量帧（前端 chat 页无增量渲染路径），文本在 done 帧整体返回
- ask_data 持久化：internal 链路 `persist=False`，不污染经典问数会话列表；代价是 Pi 模式回答无 messageId（反馈按钮禁用）——M1 已知限制
- UI 表格数据：done 帧 `data` = sampleRows（≤10 行）；全量表查看留在经典问数

---

### Task 1: Node 服务脚手架

**Files:**
- Create: `services/pi-orchestrator/package.json`
- Create: `services/pi-orchestrator/src/config.mjs`
- Create: `services/pi-orchestrator/.gitignore`
- Create: `services/pi-orchestrator/vitest.config.mts`

- [ ] **Step 1: 写 package.json / vitest 配置 / .gitignore**

`services/pi-orchestrator/package.json`:

```json
{
  "name": "@pi-wren/pi-orchestrator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.19" },
  "scripts": {
    "start": "node src/server.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.83.0",
    "@earendil-works/pi-ai": "0.83.0"
  },
  "devDependencies": {
    "vitest": "^3.2.0"
  }
}
```

`services/pi-orchestrator/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.mjs'] },
});
```

`services/pi-orchestrator/.gitignore`:

```
node_modules/
data/
```

- [ ] **Step 2: 安装依赖**

Run: `cd services/pi-orchestrator && pnpm install`
Expected: lockfile 生成，无 error

- [ ] **Step 3: pi 导入冒烟（验证 0.83.0 API 面与 spike 一致）**

Run: `cd services/pi-orchestrator && node -e "import('@earendil-works/pi-agent-core').then(m => { console.log('Agent:', typeof m.Agent); console.log('proto:', Object.getOwnPropertyNames(m.Agent.prototype).join(',')); })"`
Expected: `Agent: function` 打印出 prototype 方法列表（记录是否含 abort/stop 类方法，Task 7 护栏用）

- [ ] **Step 4: 写 config.mjs（env 解析纯函数）**

`services/pi-orchestrator/src/config.mjs`:

```js
import { fileURLToPath } from 'node:url';

/** env → 配置对象（缺必填项直接抛错，fail-fast）。 */
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PI_PORT ?? 8090),
    internalToken: env.INTERNAL_API_TOKEN ?? '',
    backendUrl: env.PY_BACKEND_URL ?? 'http://127.0.0.1:8080',
    dataDir: env.PI_DATA_DIR ?? fileURLToPath(new URL('../data/sessions', import.meta.url)),
    openaiBaseUrl: env.OPENAI_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? 'qwen3.7-flash',
    maxToolCalls: Number(env.PI_MAX_TOOL_CALLS ?? 8),
    maxDurationMs: Number(env.PI_MAX_DURATION_MS ?? 175_000),
    toolTimeoutMs: Number(env.PI_TOOL_TIMEOUT_MS ?? 120_000),
    historyTurns: 3,
  };
  if (!config.internalToken) throw new Error('INTERNAL_API_TOKEN is required');
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is required');
  return config;
}
```

- [ ] **Step 5: config 测试**

`services/pi-orchestrator/test/config.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.mjs';

const BASE = { INTERNAL_API_TOKEN: 't', OPENAI_API_KEY: 'k' };

describe('loadConfig', () => {
  it('默认值', () => {
    const c = loadConfig(BASE);
    expect(c.port).toBe(8090);
    expect(c.backendUrl).toBe('http://127.0.0.1:8080');
    expect(c.maxToolCalls).toBe(8);
  });
  it('缺 token 抛错', () => {
    expect(() => loadConfig({})).toThrow('INTERNAL_API_TOKEN');
  });
  it('缺 apiKey 抛错', () => {
    expect(() => loadConfig({ INTERNAL_API_TOKEN: 't' })).toThrow('OPENAI_API_KEY');
  });
});
```

- [ ] **Step 6: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): scaffold pi-orchestrator node service"
```

---

### Task 2: 事件协议（JSON Schema + sse 帧工具）

**Files:**
- Create: `services/pi-orchestrator/protocol/events.schema.json`
- Create: `services/pi-orchestrator/src/events.mjs`
- Test: `services/pi-orchestrator/test/events.test.mjs`

- [ ] **Step 1: 写 schema（UI 事件与 done 帧契约，与现有 AgentEvent/AgentRunResult 对齐）**

`services/pi-orchestrator/protocol/events.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "uiEvent": {
      "type": "object",
      "required": ["id", "type", "label", "timestamp"],
      "properties": {
        "id": { "type": "string" },
        "type": { "enum": ["plan", "tool_call", "tool_result", "observation", "answer", "error"] },
        "label": { "type": "string", "maxLength": 200 },
        "detail": { "type": "string" },
        "timestamp": { "type": "string" }
      }
    },
    "doneFrame": {
      "type": "object",
      "required": ["sessionId", "answer", "events", "toolCalls", "durationMs"],
      "properties": {
        "sessionId": { "type": "string" },
        "answer": { "type": "string" },
        "sql": { "type": ["string", "null"] },
        "data": { "type": ["array", "null"], "items": { "type": "object" } },
        "events": { "type": "array", "items": { "$ref": "#/$defs/uiEvent" } },
        "toolCalls": { "type": "array" },
        "durationMs": { "type": "number" },
        "messageId": { "type": ["integer", "null"] },
        "error": { "type": ["string", "null"] }
      }
    }
  }
}
```

- [ ] **Step 2: 写 events.mjs（uiEvent 构造 + sse 帧序列化 + pi 事件映射，全部纯函数）**

`services/pi-orchestrator/src/events.mjs`:

```js
import { randomUUID } from 'node:crypto';

/** 构造 UI 事件（与后端 AgentEvent 字段对齐：id/type/label/detail/timestamp）。 */
export function uiEvent(type, label, detail) {
  const event = { id: randomUUID(), type, label, timestamp: new Date().toISOString() };
  if (detail !== undefined && detail !== null) event.detail = String(detail).slice(0, 4000);
  return event;
}

/** 序列化 SSE 帧（\n\n 分帧，与前端 parseSseFrames 一致）。 */
export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * pi 事件 → UI 事件列表（0..n 条）。纯函数；state 由调用方持有用于统计工具调用。
 * pi 0.83 事件字段做防御式提取（spike 仅确认 tool_execution_start/end、message_update 存在）。
 */
export function mapPiEvent(e, state) {
  const out = [];
  if (e.type === 'tool_execution_start') {
    const name = e.toolName ?? e.tool?.name ?? e.name ?? 'tool';
    if (state) state.toolCallsStarted += 1;
    const input = e.args ?? e.input ?? e.params ?? {};
    out.push(uiEvent('tool_call', `调用工具 ${name}`, JSON.stringify(input)));
  } else if (e.type === 'tool_execution_end') {
    out.push(uiEvent('tool_result', '工具执行完成'));
  } else if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    if (state) state.text += e.assistantMessageEvent.delta ?? '';
  }
  return out;
}
```

- [ ] **Step 3: 写测试（含 schema 校验——用 Node 内置无依赖的手写断言即可，不引 ajv）**

`services/pi-orchestrator/test/events.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { mapPiEvent, sseFrame, uiEvent } from '../src/events.mjs';
import schema from '../protocol/events.schema.json' with { type: 'json' };

const UI_TYPES = schema.$defs.uiEvent.properties.type.enum;

describe('uiEvent', () => {
  it('字段齐全且 type 在协议内', () => {
    const e = uiEvent('plan', '理解问题', '各险种赔付率');
    expect(UI_TYPES).toContain(e.type);
    expect(e.id).toBeTruthy();
    expect(e.timestamp).toBeTruthy();
  });
  it('detail 截断到 4000', () => {
    const e = uiEvent('plan', 'x', 'a'.repeat(5000));
    expect(e.detail.length).toBe(4000);
  });
});

describe('sseFrame', () => {
  it('帧格式可被前端规则解析', () => {
    const frame = sseFrame('plan', { id: '1' });
    expect(frame).toMatch(/^event: plan\ndata: \{"id":"1"\}\n\n$/);
  });
});

describe('mapPiEvent', () => {
  it('tool_execution_start → tool_call 并计数', () => {
    const state = { toolCallsStarted: 0, text: '' };
    const events = mapPiEvent({ type: 'tool_execution_start', toolName: 'ask_data', args: { question: 'q' } }, state);
    expect(state.toolCallsStarted).toBe(1);
    expect(events[0].type).toBe('tool_call');
    expect(events[0].label).toContain('ask_data');
  });
  it('message_update text_delta 累积文本不发帧', () => {
    const state = { toolCallsStarted: 0, text: '' };
    const events = mapPiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你好' } }, state);
    expect(events).toHaveLength(0);
    expect(state.text).toBe('你好');
  });
  it('未知事件安全忽略', () => {
    expect(mapPiEvent({ type: 'mystery' }, { toolCallsStarted: 0, text: '' })).toHaveLength(0);
  });
});
```

- [ ] **Step 4: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): ui event protocol and pi event mapping"
```

---

### Task 3: 会话存储（JSONL，路径安全）

**Files:**
- Create: `services/pi-orchestrator/src/sessions.mjs`
- Test: `services/pi-orchestrator/test/sessions.test.mjs`

- [ ] **Step 1: 写实现**

`services/pi-orchestrator/src/sessions.mjs`:

```js
import { appendFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertId(value, label) {
  if (!ID_RE.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function sessionFile(dataDir, userKey, sessionId) {
  return join(dataDir, assertId(userKey, 'user'), `${assertId(sessionId, 'sessionId')}.jsonl`);
}

/** JSONL 会话存储：dataDir/<userKey>/<sessionId>.jsonl，每行一个 turn。 */
export function createSessionStore(dataDir) {
  return {
    /** 追加一轮问答。turn: {question, answer, sql?, data?, at} */
    async appendTurn(userKey, sessionId, turn) {
      const file = sessionFile(dataDir, userKey, sessionId);
      await mkdir(join(dataDir, userKey), { recursive: true });
      await appendFile(file, `${JSON.stringify(turn)}\n`, 'utf8');
    },

    /** 会话摘要列表（name 取首个提问，updatedAt 取末行时间），按更新时间倒序。 */
    async list(userKey) {
      const dir = join(dataDir, assertId(userKey, 'user'));
      let files;
      try {
        files = await readdir(dir);
      } catch {
        return [];
      }
      const sessions = await Promise.all(
        files
          .filter((f) => f.endsWith('.jsonl'))
          .map(async (f) => {
            const id = f.slice(0, -'.jsonl'.length);
            try {
              const lines = (await readFile(join(dir, f), 'utf8')).split('\n').filter(Boolean);
              const first = JSON.parse(lines[0]);
              const last = JSON.parse(lines[lines.length - 1]);
              return { id, name: String(first.question).slice(0, 40), updatedAt: last.at ?? '' };
            } catch {
              return null; // 损坏会话隔离：列表跳过
            }
          }),
      );
      return sessions.filter(Boolean).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    /** 单会话完整记录；不存在返回 null。损坏时抛错由调用方转 410。 */
    async get(userKey, sessionId) {
      let raw;
      try {
        raw = await readFile(sessionFile(dataDir, userKey, sessionId), 'utf8');
      } catch {
        return null;
      }
      const lines = raw.split('\n').filter(Boolean);
      const turns = lines.map((line) => JSON.parse(line));
      const messages = [];
      for (const turn of turns) {
        messages.push({ role: 'user', content: turn.question, at: turn.at });
        messages.push({ role: 'assistant', content: turn.answer, sql: turn.sql, data: turn.data, at: turn.at });
      }
      return {
        name: String(turns[0]?.question ?? '').slice(0, 40),
        sessionId,
        messages,
      };
    },

    async remove(userKey, sessionId) {
      await rm(sessionFile(dataDir, userKey, sessionId), { force: true });
    },

    /** 最近 N 轮问答（供系统提示词注入），返回 [{question, answer}]。 */
    async history(userKey, sessionId, limit = 3) {
      const session = await this.get(userKey, sessionId);
      if (!session) return [];
      const turns = [];
      for (let i = 0; i < session.messages.length; i += 2) {
        const q = session.messages[i];
        const a = session.messages[i + 1];
        if (q && a) turns.push({ question: q.content, answer: a.content });
      }
      return turns.slice(-limit);
    },
  };
}
```

- [ ] **Step 2: 写测试（vitest tmpdir）**

`services/pi-orchestrator/test/sessions.test.mjs`:

```js
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionStore } from '../src/sessions.mjs';

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-sessions-'));
  return createSessionStore(dir);
}

describe('session store', () => {
  it('append → list → get → history → remove', async () => {
    const store = await tempStore();
    await store.appendTurn('u1', 's1', { question: '各险种赔付率？', answer: '答案是…', sql: 'SELECT 1', at: '2026-09-05T10:00:00Z' });
    await store.appendTurn('u1', 's1', { question: '那理赔呢？', answer: '理赔情况…', at: '2026-09-05T10:01:00Z' });

    const list = await store.list('u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('s1');
    expect(list[0].name).toBe('各险种赔付率？');

    const session = await store.get('u1', 's1');
    expect(session.messages).toHaveLength(4);
    expect(session.messages[1].sql).toBe('SELECT 1');

    const history = await store.history('u1', 's1', 3);
    expect(history).toHaveLength(2);
    expect(history[1].question).toBe('那理赔呢？');

    await store.remove('u1', 's1');
    expect(await store.get('u1', 's1')).toBeNull();
    expect(await store.list('u1')).toHaveLength(0);
  });

  it('路径穿越被拒绝', async () => {
    const store = await tempStore();
    await expect(store.appendTurn('u1', '../evil', { question: 'x', answer: 'y', at: '' })).rejects.toThrow('invalid sessionId');
    await expect(store.get('../../etc', 'passwd')).rejects.toThrow('invalid user');
  });

  it('空列表与不存在会话', async () => {
    const store = await tempStore();
    expect(await store.list('nobody')).toEqual([]);
    expect(await store.get('nobody', 'nope')).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): jsonl session store with path traversal guard"
```

---

### Task 4: 护栏

**Files:**
- Create: `services/pi-orchestrator/src/guardrails.mjs`
- Test: `services/pi-orchestrator/test/guardrails.test.mjs`

- [ ] **Step 1: 写实现**

`services/pi-orchestrator/src/guardrails.mjs`:

```js
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
```

- [ ] **Step 2: 写测试**

`services/pi-orchestrator/test/guardrails.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { createGuardrails, withTimeout } from '../src/guardrails.mjs';

describe('guardrails', () => {
  it('工具次数上限', () => {
    const g = createGuardrails({ maxToolCalls: 2 });
    expect(g.registerToolCall()).toBe(true);
    expect(g.registerToolCall()).toBe(true);
    expect(g.registerToolCall()).toBe(false);
    expect(g.toolCalls).toBe(3);
  });
  it('时长判定', async () => {
    const g = createGuardrails({ maxDurationMs: 20 });
    expect(g.expired).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(g.expired).toBe(true);
    expect(g.elapsedMs).toBeGreaterThanOrEqual(20);
  });
});

describe('withTimeout', () => {
  it('按时完成返回原值', async () => {
    expect(await withTimeout(Promise.resolve(42), 100, () => new Error('x'))).toBe(42);
  });
  it('超时 reject 自定义错误', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 10, () => new Error('超时')),
    ).rejects.toThrow('超时');
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): request guardrails (tool cap, duration cap, timeout)"
```

---

### Task 5: ask_data 工具

**Files:**
- Create: `services/pi-orchestrator/src/tools/ask_data.mjs`
- Test: `services/pi-orchestrator/test/ask_data.test.mjs`

- [ ] **Step 1: 写实现**

`services/pi-orchestrator/src/tools/ask_data.mjs`:

```js
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
          headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
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
```

- [ ] **Step 2: 写测试（注入 fetchImpl）**

`services/pi-orchestrator/test/ask_data.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { createAskDataTool } from '../src/tools/ask_data.mjs';

function mockFetch(status, body) {
  return async (url, init) => ({
    ok: status < 400,
    status,
    json: async () => body,
    // 记录调用参数供断言
    calledWith: { url, init },
  });
}

describe('ask_data tool', () => {
  const options = { backendUrl: 'http://py:8080', internalToken: 'tok' };

  it('成功：透传 answer/sql 并截断 sampleRows', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ i }));
    let captured;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 200, json: async () => ({ answer: 'A', sql: 'SELECT 1', data: rows, durationMs: 5 }) };
    };
    const tool = createAskDataTool({ ...options, fetchImpl });
    const result = await tool.execute('id1', { question: '各险种赔付率？' });
    const payload = JSON.parse(result.content[0].text);
    expect(captured.url).toBe('http://py:8080/internal/agent/insurance/chat');
    expect(captured.init.headers['x-internal-token']).toBe('tok');
    expect(JSON.parse(captured.init.body)).toEqual({ message: '各险种赔付率？' });
    expect(payload.ok).toBe(true);
    expect(payload.rowCount).toBe(30);
    expect(payload.sampleRows).toHaveLength(10);
  });

  it('后端 4xx/5xx：ok=false 带错误信息', async () => {
    const tool = createAskDataTool({ ...options, fetchImpl: mockFetch(403, { error: '数据权限不足' }) });
    const result = await tool.execute('id1', { question: 'q' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: '数据权限不足' });
  });

  it('网络异常：ok=false', async () => {
    const tool = createAskDataTool({ ...options, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    const result = await tool.execute('id1', { question: 'q' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });

  it('超时：ok=false 查询超时', async () => {
    const tool = createAskDataTool({
      ...options,
      timeoutMs: 10,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }),
    });
    const result = await tool.execute('id1', { question: 'q' });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: false, error: '查询超时' });
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): ask_data tool calling python internal pipeline"
```

---

### Task 6: AgentService（Agent 组装 + 一轮运行）

**Files:**
- Create: `services/pi-orchestrator/src/agent-service.mjs`
- Test: `services/pi-orchestrator/test/agent-service.test.mjs`

- [ ] **Step 1: 写实现（createAgent 注入——生产用真 pi Agent，测试用 stub）**

`services/pi-orchestrator/src/agent-service.mjs`:

```js
import { uiEvent } from './events.mjs';
import { createGuardrails, withTimeout } from './guardrails.mjs';

const SYSTEM_PROMPT_BASE = [
  '你是企业数据智能平台的智能助手，用中文回答。',
  '职责：理解用户意图；涉及具体业务数据、数字、统计、清单的问题，必须调用 ask_data 工具，',
  '并根据工具返回的结果用自然语言转述与解读；禁止自行编造任何数值。',
  '与数据无关的问题（闲聊、概念解释、产品咨询）直接回答，不要调用工具。',
  '转述数据时保持与工具结果一致，不得改写、取整或推算。',
].join('');

function buildSystemPrompt(history) {
  if (!history.length) return SYSTEM_PROMPT_BASE;
  const lines = ['以下是本会话最近的对话记录（仅供参考）：'];
  for (const turn of history) {
    lines.push(`用户：${turn.question}`);
    lines.push(`助手：${turn.answer}`);
  }
  return `${lines.join('\n')}\n\n${SYSTEM_PROMPT_BASE}`;
}

/** 工具包装：超限时返回引导收尾的错误结果，不真调后端。 */
function guardToolCall(tool, guardrails) {
  return {
    ...tool,
    execute: async (id, params) => {
      if (!guardrails.registerToolCall()) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ok: false, error: '已达单次请求工具调用上限，请基于已有结果直接回答用户' }),
          }],
        };
      }
      return tool.execute(id, params);
    },
  };
}

/**
 * 一轮对话：历史注入 → Agent 循环（pi）→ 事件实时回调 → 持久化 → 汇总结果。
 * createAgent 注入：({ systemPrompt, model, tools, sessionId, onEvent }) => { prompt(q), subscribe(fn), abort? }
 */
export function createAgentService({ config, model, tools, store, createAgent }) {
  return {
    async run({ userKey, sessionId, question, onUiEvent }) {
      const guardrails = createGuardrails(config);
      const history = await store.history(userKey, sessionId, config.historyTurns);
      const state = { toolCallsStarted: 0, text: '' };
      const events = [];

      const push = (event) => {
        events.push(event);
        onUiEvent?.(event);
      };
      push(uiEvent('plan', '理解问题', question));

      const agent = createAgent({
        systemPrompt: buildSystemPrompt(history),
        model,
        tools: tools.map((tool) => guardToolCall(tool, guardrails)),
        sessionId,
        onPiEvent: (e) => {
          for (const event of mapPiEvents(e, state)) push(event);
        },
      });

      let timedOut = false;
      try {
        await withTimeout(agent.prompt(question), config.maxDurationMs, () => new Error('单次请求时长达到上限'));
      } catch (err) {
        timedOut = true;
        push(uiEvent('error', '执行超时', String(err.message ?? err)));
      }

      let answer = state.text.trim();
      if (!answer) {
        answer = timedOut
          ? '本次请求超时，请稍后重试，或把问题拆小一些再问。'
          : '（未生成回答，请重试）';
      }
      push(uiEvent('answer', '生成回答', answer));

      await store.appendTurn(userKey, sessionId, {
        question,
        answer,
        at: new Date().toISOString(),
      });

      return { answer, events, durationMs: guardrails.elapsedMs, toolCalls: guardrails.toolCalls };
    },
  };
}

// 延迟引入避免测试环境强依赖 pi 包（stub 场景不 import）
function mapPiEvents(e, state) {
  // eslint 风格的惰性 require 不可用于 ESM——直接静态引入
  return staticMapPiEvent(e, state);
}

import { mapPiEvent as staticMapPiEvent } from './events.mjs';
```

注意：文件末尾的 import 提升到顶部（ESM import 会提升，功能正确但风格差——实现时把 `import { mapPiEvent } from './events.mjs'` 放文件头并删除 `mapPiEvents` 包装，直接调用 `mapPiEvent`）。

- [ ] **Step 2: 写测试（stub createAgent 脚本化事件）**

`services/pi-orchestrator/test/agent-service.test.mjs`:

```js
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentService } from '../src/agent-service.mjs';
import { createSessionStore } from '../src/sessions.mjs';

const CONFIG = { maxToolCalls: 8, maxDurationMs: 175_000, historyTurns: 3 };

function stubAgent(script) {
  return ({ onPiEvent }) => ({
    async prompt(question) {
      for (const e of script) onPiEvent(e);
      onPiEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '最终回答' } });
    },
    subscribe() {},
  });
}

async function service(script, store) {
  return createAgentService({ config: CONFIG, model: 'stub', tools: [], store, createAgent: stubAgent(script) });
}

describe('agent service', () => {
  it('一轮运行：事件顺序、文本累积、历史持久化', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-svc-'));
    const store = createSessionStore(dir);
    const svc = await service([
      { type: 'tool_execution_start', toolName: 'ask_data', args: {} },
      { type: 'tool_execution_end' },
    ], store);

    const ui = [];
    const result = await svc.run({ userKey: 'u1', sessionId: 's1', question: '赔付率？', onUiEvent: (e) => ui.push(e.type) });

    expect(ui).toEqual(['plan', 'tool_call', 'tool_result', 'answer']);
    expect(result.answer).toBe('最终回答');
    expect(result.toolCalls).toBe(0); // stub 未走 guard 包装的 execute，只统计 pi 事件
    const history = await store.history('u1', 's1', 3);
    expect(history).toHaveLength(1);
    expect(history[0].answer).toBe('最终回答');
  });

  it('第二轮注入历史（系统提示词含上一轮）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-svc-'));
    const store = createSessionStore(dir);
    const seen = [];
    const svc = createAgentService({
      config: CONFIG, model: 'stub', tools: [], store,
      createAgent: ({ systemPrompt }) => ({
        async prompt() {
          seen.push(systemPrompt);
          onText();
          function onText() {}
        },
        subscribe() {},
      }),
    });
    await svc.run({ userKey: 'u1', sessionId: 's2', question: '第一问', onUiEvent: () => {} });
    await svc.run({ userKey: 'u1', sessionId: 's2', question: '第二问', onUiEvent: () => {} });
    expect(seen[0]).not.toContain('第一问');
    expect(seen[1]).toContain('第一问');
  });

  it('prompt 抛错 → error 事件 + 兜底回答，不抛出', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-svc-'));
    const store = createSessionStore(dir);
    const svc = createAgentService({
      config: CONFIG, model: 'stub', tools: [], store,
      createAgent: () => ({ prompt: () => Promise.reject(new Error('LLM 429')), subscribe() {} }),
    });
    const ui = [];
    const result = await svc.run({ userKey: 'u1', sessionId: 's3', question: 'q', onUiEvent: (e) => ui.push(e.type) });
    expect(ui).toContain('error');
    expect(result.answer).toContain('未生成回答');
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): agent service with history injection and guardrails"
```

---

### Task 7: HTTP 服务（SSE + internal token 鉴权）

**Files:**
- Create: `services/pi-orchestrator/src/server.mjs`
- Test: `services/pi-orchestrator/test/server.test.mjs`

- [ ] **Step 1: 写实现（node:http 裸服务，无框架依赖）**

`services/pi-orchestrator/src/server.mjs`:

```js
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createModels, createProvider, envApiKeyAuth, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { Agent } from '@earendil-works/pi-agent-core';
import { loadConfig } from './config.mjs';
import { sseFrame } from './events.mjs';
import { createSessionStore } from './sessions.mjs';
import { createAskDataTool } from './tools/ask_data.mjs';
import { createAgentService } from './agent-service.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(value, fallback) {
  return typeof value === 'string' && ID_RE.test(value) ? value : fallback;
}

function buildModel(config) {
  const credentials = new InMemoryCredentialStore();
  const provider = createProvider({
    id: 'pi-llm',
    name: 'PI LLM',
    baseUrl: config.openaiBaseUrl,
    auth: { apiKey: envApiKeyAuth('PI LLM API key', ['OPENAI_API_KEY']) },
    models: [{
      id: config.openaiModel, name: config.openaiModel, api: 'openai-completions',
      provider: 'pi-llm', baseUrl: config.openaiBaseUrl, reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768, maxTokens: 4096,
    }],
    api: { 'openai-completions': openAICompletionsApi() },
  });
  const models = createModels({ credentials });
  models.setProvider(provider);
  return models.getModel('pi-llm', config.openaiModel);
}

/** 生产 createAgent：真 pi Agent（0.83 API，见 docs/spikes/pi-agent）。 */
export function createPiAgent({ systemPrompt, model, tools, sessionId, onPiEvent }) {
  const agent = new Agent({
    initialState: { systemPrompt, model, tools },
    streamFn: undefined, // 由 server 装配时注入 models.streamSimple
    sessionId,
  });
  agent.subscribe(onPiEvent);
  return {
    prompt: (question) => agent.prompt(question),
    abort: typeof agent.abort === 'function' ? () => agent.abort() : null,
  };
}

export function createAppService({ config, store, createAgent = null }) {
  const model = createAgent ? 'stub' : buildModel(config);
  const askData = createAskDataTool(config);
  const service = createAgentService({
    config,
    model,
    tools: [askData],
    store,
    createAgent: createAgent ?? ((args) => {
      const wired = createPiAgent({ ...args, streamFn: undefined });
      return wired;
    }),
  });
  return { service };
}

export function createHandler({ config, store, service }) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };

    // internal token 全端点强制
    const token = req.headers['x-internal-token'] ?? '';
    const expected = config.internalToken;
    const okToken =
      expected.length > 0 &&
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!okToken) {
      send(401, { error: 'invalid internal token' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      send(200, { status: 'ok' });
      return;
    }

    const userKey = safeId(req.headers['x-user-id'] ?? '', 'anonymous');
    const sessionId = safeId(url.pathname.split('/')[2] ?? '', '');

    if (req.method === 'GET' && url.pathname === '/sessions') {
      send(200, { sessions: await store.list(userKey) });
      return;
    }
    if (sessionId && req.method === 'GET' && url.pathname.startsWith('/sessions/')) {
      const session = await store.get(userKey, sessionId);
      if (!session) {
        send(404, { error: 'session not found' });
        return;
      }
      send(200, session);
      return;
    }
    if (sessionId && req.method === 'DELETE' && url.pathname.startsWith('/sessions/')) {
      await store.remove(userKey, sessionId);
      send(200, { ok: true });
      return;
    }

    if (sessionId && req.method === 'POST' && url.pathname.startsWith('/sessions/') && url.pathname.endsWith('/messages')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      let message = '';
      try {
        message = String(JSON.parse(body).message ?? '').trim();
      } catch {
        send(400, { error: 'invalid JSON body' });
        return;
      }
      if (!message || message.length > 4000) {
        send(400, { error: 'message is required (1-4000 chars)' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      const started = Date.now();
      let closed = false;
      req.on('close', () => {
        closed = true;
      });

      try {
        const result = await service.run({
          userKey,
          sessionId,
          question: message,
          onUiEvent: (event) => {
            if (!closed) res.write(sseFrame(event.type, event));
          },
        });
        if (!closed) {
          res.write(sseFrame('done', {
            sessionId,
            answer: result.answer,
            sql: null,
            data: result.data ?? null,
            events: result.events,
            toolCalls: [],
            durationMs: result.durationMs,
            messageId: null,
            error: null,
          }));
        }
      } catch (err) {
        if (!closed) {
          res.write(sseFrame('error', { id: 'e', type: 'error', label: '服务错误', detail: String(err?.message ?? err), timestamp: new Date().toISOString() }));
        }
      } finally {
        if (!closed) res.end();
      }
      return;
    }

    send(404, { error: 'not found' });
  };
}

export async function startServer({ config, store, service, listen = true }) {
  const handler = createHandler({ config, store, service });
  const server = createServer(handler);
  if (listen) {
    await new Promise((resolve) => server.listen(config.port, '127.0.0.1', resolve));
  }
  return server;
}

// 直接运行入口
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const config = loadConfig();
  const store = createSessionStore(config.dataDir);
  const { service } = createAppService({ config, store });
  startServer({ config, store, service }).then((server) => {
    console.log(`pi-orchestrator listening on http://127.0.0.1:${config.port}`);
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
```

装配注意：`createAppService` 里真 Agent 的 `streamFn` 需要 `models.streamSimple.bind(models)`——实现时把 buildModel 返回 `{ model, models }`，`createPiAgent` 接收 `streamFn` 参数传给 Agent 构造。测试路径（注入 createAgent）不触碰 pi 包。

- [ ] **Step 2: 写测试（真实 HTTP 监听随机端口）**

`services/pi-orchestrator/test/server.test.mjs`:

```js
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionStore } from '../src/sessions.mjs';
import { createAppService, createHandler, startServer } from '../src/server.mjs';

const CONFIG = {
  internalToken: 'secret-token',
  maxToolCalls: 8,
  maxDurationMs: 175_000,
  historyTurns: 3,
};

let server;
let baseUrl;
const stubAnswer = 'stub 回答';

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-server-'));
  const store = createSessionStore(dir);
  const config = { ...CONFIG, dataDir: dir };
  const service = {
    async run({ question, onUiEvent }) {
      onUiEvent({ id: '1', type: 'plan', label: '理解问题', detail: question, timestamp: new Date().toISOString() });
      return { answer: stubAnswer, events: [], durationMs: 1, toolCalls: 0 };
    },
  };
  server = await startServer({ config, store, service, listen: true });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function headers(extra = {}) {
  return { 'x-internal-token': 'secret-token', 'x-user-id': 'u1', ...extra };
}

describe('server auth', () => {
  it('无 token 401', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(401);
  });
  it('错误 token 401', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { 'x-internal-token': 'wrong' } });
    expect(res.status).toBe(401);
  });
  it('health 200', async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: headers() });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });
});

describe('sessions endpoints', () => {
  it('list 空 → append 由 service 模拟 → get/delete', async () => {
    const list = await (await fetch(`${baseUrl}/sessions`, { headers: headers() })).json();
    expect(list.sessions).toEqual([]);
    const notFound = await fetch(`${baseUrl}/sessions/nope`, { headers: headers() });
    expect(notFound.status).toBe(404);
  });
});

describe('messages SSE', () => {
  it('SSE 流含 plan 与 done 帧', async () => {
    const res = await fetch(`${baseUrl}/sessions/s-abc/messages`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '各险种赔付率？' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: plan');
    expect(text).toContain('event: done');
    const doneLine = text.split('\n\n').find((f) => f.startsWith('event: done'));
    const payload = JSON.parse(doneLine.match(/^data: (.+)$/m)[1]);
    expect(payload.answer).toBe(stubAnswer);
    expect(payload.sessionId).toBe('s-abc');
  });
  it('空消息 400', async () => {
    const res = await fetch(`${baseUrl}/sessions/s-abc/messages`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `cd services/pi-orchestrator && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/pi-orchestrator
git commit -m "feat(pi): http server with sse streaming and internal token auth"
```

---

### Task 8: Python 配置 + 中间件豁免 + httpx 主依赖

**Files:**
- Modify: `backend/app/config.py:104`（Session & Custom Agents 段后追加配置）
- Modify: `backend/app/auth/middleware.py:14`（豁免前缀加 `/internal`）
- Modify: `backend/pyproject.toml`（httpx 移入主依赖）
- Test: `backend/tests/test_internal_agent.py`（Task 9 创建，这里只改配置）

- [ ] **Step 1: config.py 增加配置（在 `AUDIT_USER_ID` 行之后）**

```python
    # --- Pi 编排层（M1）---
    # Pi orchestrator（Node sidecar）地址；空 = 智能助手关闭（/api/assistant 返回 503 优雅降级）
    PI_ORCHESTRATOR_URL: str | None = None
    # Python ↔ Pi 双向调用的内部令牌（两者必须一致；未配置 = internal 接口拒绝一切调用）
    INTERNAL_API_TOKEN: str | None = None
    PI_TOOL_TIMEOUT_SECONDS: int = Field(120, ge=1, le=600)
```

- [ ] **Step 2: middleware.py 豁免 /internal（内部接口用 internal token 自保护）**

```python
_EXEMPT_PREFIXES = ("/api/auth/", "/api/health", "/health", "/docs", "/openapi.json", "/internal")
```

- [ ] **Step 3: pyproject.toml dependencies 数组加入（放在 asyncpg 之后）**

```toml
    "httpx>=0.27",
```

同时从 dev 可选依赖中删除重复的 `"httpx>=0.27",`（避免重复声明）。

- [ ] **Step 4: 安装并验证**

Run: `cd backend && ../.venv/Scripts/pip.exe install httpx -q && ../.venv/Scripts/python.exe -c "from app.config import get_settings; s = get_settings(); print(s.PI_ORCHESTRATOR_URL)"`
Expected: `None`（尚未配置）

- [ ] **Step 5: 跑全量 pytest 确认无回归**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest -q`
Expected: 全部 PASS（既有测试不受影响）

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/auth/middleware.py backend/pyproject.toml
git commit -m "feat(api): pi orchestrator settings and internal route exemption"
```

---

### Task 9: internal 路由 + answer persist 参数

**Files:**
- Modify: `backend/app/agents/data_analysis.py:60-67`（answer 增加 persist 参数）、`:232-236`（保存块条件化）
- Create: `backend/app/routers/internal.py`
- Test: `backend/tests/test_internal_agent.py`

- [ ] **Step 1: answer 增加 persist 参数（签名与保存块）**

`data_analysis.py` 签名改为：

```python
    async def answer(
        self,
        question: str,
        *,
        session_id: str | None = None,
        on_event=None,
        user_id: str | None = None,
        org_access: OrgAccess | None = None,
        persist: bool = True,
    ) -> AgentRunResult:
```

docstring 补一行：`persist=False 时跳过会话落库（internal 链路由 Pi 侧存储负责）。`

保存块（原 `if self._memory:`）改为：

```python
            if self._memory and persist:
```

- [ ] **Step 2: 写失败测试**

`backend/tests/test_internal_agent.py`:

```python
"""internal 路由测试：token 鉴权、身份反查权限、persist=False 透传。"""
from types import SimpleNamespace

from fastapi import Request

from app.auth.org_access import OrgAccess
from app.models.schemas import AgentRunResult
from app.routers.internal import _check_internal_token, _resolve_access, internal_agent_chat


def _request(headers: dict | None = None, app_state=None) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "app": SimpleNamespace(state=SimpleNamespace(app_state=app_state)),
    }
    return Request(scope)


def _state(auth_enabled=True, user=None, spec=None):
    return SimpleNamespace(
        settings=SimpleNamespace(INTERNAL_API_TOKEN="tok", AUTH_ENABLED=auth_enabled),
        users=SimpleNamespace(find_by_user_id=lambda uid: user) if auth_enabled else None,
        get_agent=lambda domain: spec,
    )


_USER = SimpleNamespace(user_id="U1", username="alice", display_name="Alice", role="user", status="active", org_id="ORG1")


def test_token_check():
    request = _request({"x-internal-token": "tok"})
    assert _check_internal_token(request, _state().settings) is None
    bad = _request({"x-internal-token": "nope"})
    response = _check_internal_token(bad, _state().settings)
    assert response.status_code == 401
    missing = _request({})
    assert _check_internal_token(missing, _state().settings).status_code == 401
    unconfigured = _request({"x-internal-token": "tok"})
    assert _check_internal_token(unconfigured, SimpleNamespace(INTERNAL_API_TOKEN=None)).status_code == 401


async def test_resolve_access_from_user_lookup():
    state = _state(user=_USER)
    access, user_id = await _resolve_access(_request({"x-user-id": "U1"}), state)
    assert user_id == "U1"
    assert access == OrgAccess(MODE := "org", "ORG1")


async def test_resolve_access_unknown_user_401():
    state = _state(user=None)
    response = await _resolve_access(_request({"x-user-id": "GHOST"}), state)
    assert response.status_code == 401


async def test_resolve_access_auth_disabled_unrestricted():
    state = _state(auth_enabled=False)
    access, user_id = await _resolve_access(_request({}), state)
    assert access.mode == "unrestricted"
    assert user_id is None


async def test_internal_agent_chat_passes_persist_false():
    captured = {}

    async def fake_answer(question, **kwargs):
        captured.update(kwargs, question=question)
        return AgentRunResult(sessionId="s1", answer="ok", trace=[], events=[], toolCalls=[], durationMs=1)

    spec = SimpleNamespace(agent=SimpleNamespace(answer=fake_answer))
    state = _state(user=_USER, spec=spec)
    request = _request({"x-user-id": "U1"}, state)

    async def json_body():
        return {"message": "赔付率？", "sessionId": "s1"}

    request.json = json_body
    response = await internal_agent_chat("insurance", request)
    assert captured["persist"] is False
    assert captured["user_id"] == "U1"
    assert response.status_code == 200
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest tests/test_internal_agent.py -q`
Expected: FAIL（`app.routers.internal` 不存在）

- [ ] **Step 4: 写实现**

`backend/app/routers/internal.py`:

```python
"""内部接口：供 Pi orchestrator 调用（internal token 鉴权，非公网）。

权限不从请求头取——按 x-user-id 反查本地用户表构造 OrgAccess，头部只传身份不传权限。
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.auth.org_access import MODE_DENY, MODE_ORG, OrgAccess
from app.deps import AppState

router = APIRouter(prefix="/internal")


def _check_internal_token(request: Request, settings) -> JSONResponse | None:
    """internal token 常量时间比较；未配置 = 拒绝一切（fail-closed）。"""
    expected = settings.INTERNAL_API_TOKEN or ""
    provided = request.headers.get("x-internal-token", "")
    if not expected or not provided or not secrets.compare_digest(provided, expected):
        return JSONResponse(status_code=401, content={"error": "invalid internal token"})
    return None


async def _resolve_access(request: Request, state: AppState) -> tuple[OrgAccess | None, str | None, JSONResponse | None]:
    """身份反查：AUTH_ENABLED 时按 user_id 查用户（缓存命中，1 次 DB/内存）构造三态权限。"""
    user_id = request.headers.get("x-user-id")
    if not state.settings.AUTH_ENABLED:
        return OrgAccess.unrestricted(), user_id, None
    user = await state.users.find_by_user_id(user_id) if (user_id and state.users) else None
    if user is None or user.status != "active":
        return None, user_id, JSONResponse(status_code=401, content={"error": "unknown or inactive user"})
    return OrgAccess.for_user(user), user_id, None


@router.post("/agent/{domain}/chat")
async def internal_agent_chat(domain: str, request: Request):
    state: AppState = request.app.state.app_state
    token_error = _check_internal_token(request, state.settings)
    if token_error:
        return token_error

    access, user_id, access_error = await _resolve_access(request, state)
    if access_error:
        return access_error

    spec = state.get_agent(domain)
    if not spec:
        return JSONResponse(status_code=404, content={"error": f"unknown agent: {domain}"})

    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message or len(message) > 4000:
        return JSONResponse(status_code=400, content={"error": "message is required (1-4000 chars)"})
    session_id = body.get("sessionId") or None

    # persist=False：会话历史由 Pi 侧 JSONL 负责，不写入经典问数会话列表
    result = await spec.agent.answer(
        message, session_id=session_id, user_id=user_id, org_access=access, persist=False,
    )
    return JSONResponse(content=result.model_dump())
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest tests/test_internal_agent.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/agents/data_analysis.py backend/app/routers/internal.py backend/tests/test_internal_agent.py
git commit -m "feat(api): internal agent endpoint for pi orchestrator"
```

---

### Task 10: assistant 代理路由（SSE 透传 + 熔断）

**Files:**
- Create: `backend/app/routers/assistant.py`
- Modify: `backend/app/main.py:20`（import 增加 assistant）、`:96` 附近（include_router）
- Test: `backend/tests/test_assistant_proxy.py`

- [ ] **Step 1: 写失败测试**

`backend/tests/test_assistant_proxy.py`:

```python
"""assistant 代理测试：未启用 503、熔断状态机、转发头构造。"""
from types import SimpleNamespace

from app.routers.assistant import CircuitBreaker, _forward_headers, assistant_chat_stream


def test_circuit_breaker_states():
    breaker = CircuitBreaker(fail_threshold=3, open_seconds=30)
    t = 1000.0
    assert not breaker.is_open(t)
    breaker.record_failure(t)
    breaker.record_failure(t)
    assert not breaker.is_open(t)  # 未达阈值
    breaker.record_failure(t)
    assert breaker.is_open(t)  # 打开
    assert not breaker.is_open(t + 31)  # 超时半开
    breaker.record_success(t + 31)
    assert not breaker.is_open(t + 40)  # 复位


def _request(app_state, headers=None):
    from fastapi import Request

    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "app": SimpleNamespace(state=SimpleNamespace(app_state=app_state)),
        "client": ("testclient", 123),
    }
    return Request(scope)


def test_forward_headers_injects_identity():
    settings = SimpleNamespace(INTERNAL_API_TOKEN="tok")
    state_user = SimpleNamespace(user_id="U1", org_id="ORG1")
    headers = _forward_headers(settings, state_user)
    assert headers["x-internal-token"] == "tok"
    assert headers["x-user-id"] == "U1"


def test_forward_headers_anonymous_when_no_user():
    settings = SimpleNamespace(INTERNAL_API_TOKEN="tok")
    headers = _forward_headers(settings, None)
    assert headers["x-user-id"] == "anonymous"


async def test_stream_503_when_not_configured():
    state = SimpleNamespace(
        settings=SimpleNamespace(PI_ORCHESTRATOR_URL=None, INTERNAL_API_TOKEN="tok"),
        rate_limit_chat=None,
    )
    request = _request(state)
    request.state.user = None

    async def json_body():
        return {"message": "hi"}

    request.json = json_body
    response = await assistant_chat_stream(request)
    assert response.status_code == 503
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest tests/test_assistant_proxy.py -q`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`backend/app/routers/assistant.py`:

```python
"""Pi 智能助手代理：/api/assistant/* → Pi orchestrator（SSE 透传 + 熔断降级）。

鉴权/限流复用现有中间件与限流器；身份经 x-user-id 头透传（权限由 internal 路由反查）。
PI_ORCHESTRATOR_URL 未配置时整体 503 优雅降级，经典 /chat 不受影响。
"""
from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger

from app.deps import AppState

router = APIRouter(prefix="/api/assistant")

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}


class CircuitBreaker:
    """连接失败熔断：连续 fail_threshold 次打开 open_seconds 秒，超时自然半开，成功复位。"""

    def __init__(self, fail_threshold: int = 3, open_seconds: float = 30.0):
        self.fail_threshold = fail_threshold
        self.open_seconds = open_seconds
        self._consecutive = 0
        self._opened_until = 0.0

    def is_open(self, now: float | None = None) -> bool:
        return (now if now is not None else time.monotonic()) < self._opened_until

    def record_failure(self, now: float | None = None) -> None:
        now = now if now is not None else time.monotonic()
        self._consecutive += 1
        if self._consecutive >= self.fail_threshold:
            self._opened_until = now + self.open_seconds
            self._consecutive = 0

    def record_success(self) -> None:
        self._consecutive = 0
        self._opened_until = 0.0


# 进程级单例（uvicorn 单进程模型下安全）
_breaker = CircuitBreaker()


def _forward_headers(settings, user) -> dict[str, str]:
    headers = {
        "x-internal-token": settings.INTERNAL_API_TOKEN or "",
        "x-user-id": user.user_id if user else "anonymous",
    }
    return headers


def _upstream_base(state: AppState) -> str | None:
    base = (state.settings.PI_ORCHESTRATOR_URL or "").rstrip("/")
    return base or None


def _check_rate_limit(state: AppState, request: Request, user_id: str | None) -> JSONResponse | None:
    limiter = state.rate_limit_chat
    if limiter is None or limiter.limit == 0:
        return None
    key = f"user:{user_id}" if user_id else f"ip:{request.client.host if request.client else 'unknown'}"
    if not limiter.allow(key):
        retry = limiter.retry_after(key)
        return JSONResponse(
            status_code=429,
            headers={"Retry-After": str(retry)},
            content={"error": f"请求过于频繁，请 {retry} 秒后重试"},
        )
    return None


async def _upstream_json(method: str, url: str, headers: dict, *, json_body: dict | None = None) -> JSONResponse | httpx.Response:
    """带熔断的非流式转发。连接失败计熔断；打开时直接 503。"""
    if _breaker.is_open():
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})
    try:
        response = await _client().request(method, url, headers=headers, json=json_body, timeout=10)
    except httpx.HTTPError as exc:
        _breaker.record_failure()
        logger.warning("assistant upstream failure: {}", exc)
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})
    _breaker.record_success()
    return response


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient()


@router.post("/chat/stream")
async def assistant_chat_stream(request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用（未配置 PI_ORCHESTRATOR_URL）"})

    user = getattr(request.state, "user", None)
    user_id = user.user_id if user else None
    limited = _check_rate_limit(state, request, user_id)
    if limited:
        return limited

    body = await request.json()
    message = (body.get("message") or "").strip()
    if not message or len(message) > 4000:
        return JSONResponse(status_code=400, content={"error": "message is required (1-4000 chars)"})
    session_id = body.get("sessionId") or None

    if _breaker.is_open():
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})

    headers = _forward_headers(state.settings, user)
    logger.info("assistant stream: session={} user={}", session_id, user_id or "-")

    try:
        upstream = _client().stream(
            "POST", f"{base}/sessions/{session_id or 'default'}/messages",
            headers=headers, json={"message": message},
            timeout=httpx.Timeout(190.0, connect=5.0),
        )
    except httpx.HTTPError:
        _breaker.record_failure()
        return JSONResponse(status_code=503, content={"error": "智能助手暂不可用，请稍后重试"})

    async def relay():
        try:
            async with upstream as response:
                if response.status_code != 200:
                    detail = (await response.aread()).decode("utf-8", "replace")
                    _breaker.record_success()  # 上游可达，业务错误不计熔断
                    yield (f"event: error\ndata: {detail}".encode(), response.status_code)
                    return
                _breaker.record_success()
                async for chunk in response.aiter_bytes():
                    yield (chunk, 200)
        except httpx.HTTPError as exc:
            _breaker.record_failure()
            logger.warning("assistant stream interrupted: {}", exc)
            yield (b"event: error\ndata: {\"error\": \"\\u667a\\u80fd\\u52a9\\u624b\\u8fde\\u63a5\\u4e2d\\u65ad\"}\n\n", 503)

    async def generator():
        async for chunk, status in relay():
            if status != 200:
                # 上游业务错误包成 SSE error 帧后正常结束（保持事件流契约）
                yield chunk + b"\n\n"
                yield b"event: done\ndata: {\"sessionId\":\"\",\"answer\":\"\",\"events\":[],\"toolCalls\":[],\"durationMs\":0,\"error\":\"upstream error\"}\n\n"
            else:
                yield chunk

    return StreamingResponse(generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/sessions")
async def assistant_sessions(request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用"})
    headers = _forward_headers(state.settings, getattr(request.state, "user", None))
    response = await _upstream_json("GET", f"{base}/sessions", headers)
    return response


@router.get("/sessions/{session_id}")
async def assistant_session_detail(session_id: str, request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用"})
    headers = _forward_headers(state.settings, getattr(request.state, "user", None))
    response = await _upstream_json("GET", f"{base}/sessions/{session_id}", headers)
    return response


@router.delete("/sessions/{session_id}")
async def assistant_session_delete(session_id: str, request: Request):
    state: AppState = request.app.state.app_state
    base = _upstream_base(state)
    if not base:
        return JSONResponse(status_code=503, content={"error": "智能助手未启用"})
    headers = _forward_headers(state.settings, getattr(request.state, "user", None))
    response = await _upstream_json("DELETE", f"{base}/sessions/{session_id}", headers)
    return response
```

实现时需修正两处流式细节（写文件时直接写对）：
1. `httpx.AsyncClient.stream()` 是 async context manager，不能在 try 里 `await`——正确写法是把整个 `async with` 放进 relay 的异步生成器内，`except httpx.HTTPError` 包住它；连接失败（进入 async with 前）抛 `httpx.ConnectError` 同样被捕获计熔断。
2. relay 返回 (chunk, status) 二元组再由 generator 分发的结构过于绕——直接在 generator 里完成 `async with` 与异常处理，错误分支输出 error 帧 + done 帧（error="upstream error"）后正常收尾。

- [ ] **Step 4: main.py 注册路由**

import 行改为：

```python
from app.routers import admin_agents, admin_users, agents, assistant, auth, chat, graph, health, internal, sessions, traditional
```

`app.include_router(internal.router)` 与 `app.include_router(assistant.router)` 加在 `app.include_router(graph.router)` 之后。

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `cd backend && ../.venv/Scripts/python.exe -m pytest tests/test_assistant_proxy.py tests/test_internal_agent.py -q && ../.venv/Scripts/python.exe -m pytest -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/assistant.py backend/app/routers/internal.py backend/app/main.py backend/tests/test_assistant_proxy.py
git commit -m "feat(api): assistant proxy with sse passthrough and circuit breaker"
```

---

### Task 11: 前端 /chat Pi 灰度开关

**Files:**
- Modify: `frontend/apps/web/app/chat/page.tsx`

- [ ] **Step 1: 加 Pi 模式状态与开关（header 右侧）**

在 `const [copiedId, setCopiedId] = useState<string | null>(null);` 之后加：

```tsx
  // Pi 编排灰度开关（M1）：开启后走 /api/assistant/*（Pi 多工具编排），关闭走经典问数
  const [piMode, setPiMode] = useState(false);
  useEffect(() => {
    setPiMode(localStorage.getItem('piwren_assistant_mode') === '1');
  }, []);
  const togglePiMode = useCallback(() => {
    setPiMode((prev) => {
      const next = !prev;
      localStorage.setItem('piwren_assistant_mode', next ? '1' : '0');
      return next;
    });
    setMessages([]);
    setActiveSessionId(undefined);
  }, []);
```

import 处补 `Switch`：

```tsx
import { Button, Collapse, Switch } from '../components/ui';
```

- [ ] **Step 2: 切换端点（send / loadSessions / openSession / deleteSession）**

`loadSessions` 内 fetch URL 改为：

```ts
        const url = piMode
          ? `/api/assistant/sessions${query ? `?search=${encodeURIComponent(query)}` : ''}`
          : `/api/sessions${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await apiFetch(url);
```

`send` 内：

```ts
        const response = await apiFetch(
          piMode ? '/api/assistant/chat/stream' : `/api/agent/${domain}/chat/stream`,
          { ... },
        );
```

`openSession` 内：

```ts
        const response = await apiFetch(
          piMode
            ? `/api/assistant/sessions/${encodeURIComponent(sessionId)}`
            : `/api/sessions/${encodeURIComponent(sessionId)}`,
        );
```

`deleteSession` 内同理替换 URL。注意各 useCallback 的依赖数组补 `piMode`。

- [ ] **Step 3: header 渲染开关**

`chat-header-right` 内、会话 id 显示之前加：

```tsx
            <span className="meta">Pi 编排</span>
            <Switch checked={piMode} onChange={togglePiMode} />
```

- [ ] **Step 4: 前端验证**

Run: `cd frontend/apps/web && pnpm typecheck && pnpm lint && pnpm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/apps/web/app/chat/page.tsx
git commit -m "feat(web): pi orchestrator mode toggle on chat page"
```

---

### Task 12: 配置样例 / Dockerfile / compose

**Files:**
- Modify: `.env`（追加两个配置，生成随机 token）
- Modify: `.env.example`（若存在，同步注释样例）
- Create: `services/pi-orchestrator/Dockerfile`
- Modify: `docker-compose.yml`（新增 pi-orchestrator 服务，profile 门控）

- [ ] **Step 1: .env 追加（token 用 python secrets 生成）**

```bash
cd D:/study/pi-wren-platform
TOKEN=$(.venv/Scripts/python.exe -c "import secrets; print(secrets.token_urlsafe(32))")
printf '\n# --- Pi 编排层（M1）---\nPI_ORCHESTRATOR_URL=http://127.0.0.1:8090\nINTERNAL_API_TOKEN=%s\nPI_PORT=8090\nPY_BACKEND_URL=http://127.0.0.1:8080\n' "$TOKEN" >> .env
grep -n "PI_ORCHESTRATOR_URL\|INTERNAL_API_TOKEN" .env
```

`.env.example` 追加（注释掉的样例值）：

```
# --- Pi 编排层（M1，可选）---
# PI_ORCHESTRATOR_URL=http://127.0.0.1:8090
# INTERNAL_API_TOKEN=change-me-to-a-random-token
# PI_PORT=8090
# PY_BACKEND_URL=http://127.0.0.1:8080
```

- [ ] **Step 2: Dockerfile**

`services/pi-orchestrator/Dockerfile`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY src ./src
COPY protocol ./protocol
ENV PI_DATA_DIR=/app/data/sessions
VOLUME ["/app/data"]
EXPOSE 8090
CMD ["node", "src/server.mjs"]
```

- [ ] **Step 3: docker-compose.yml 增加（services 列表末尾）**

```yaml

  pi-orchestrator:
    build: ./services/pi-orchestrator
    profiles: ["pi"]
    environment:
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      PY_BACKEND_URL: http://postgres-host:8080
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      OPENAI_BASE_URL: ${OPENAI_BASE_URL}
      OPENAI_MODEL: ${OPENAI_MODEL}
    ports:
      - '8090:8090'
```

注意 `PY_BACKEND_URL` 在 compose 网络内应指向宿主机上的 FastAPI——开发态 FastAPI 跑在宿主机，容器内用 `http://host.docker.internal:8080`（Linux 需 extra_hosts）。写文件时用：

```yaml
    environment:
      PY_BACKEND_URL: http://host.docker.internal:8080
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

- [ ] **Step 4: Commit**

```bash
git add .env .env.example services/pi-orchestrator/Dockerfile docker-compose.yml
git commit -m "feat(deploy): pi orchestrator config, dockerfile and compose profile"
```

---

### Task 13: 端到端联调验证

**Files:** 无新文件（验证任务）

- [ ] **Step 1: 全量回归（Node + Python + 前端）**

```bash
cd services/pi-orchestrator && pnpm test
cd ../../backend && ../.venv/Scripts/python.exe -m pytest -q
cd ../frontend/apps/web && pnpm typecheck && pnpm lint && pnpm test
```
Expected: 全部 PASS

- [ ] **Step 2: 起服务**

```bash
# 依赖容器已在跑（postgres/redis）
cd backend && ../.venv/Scripts/python.exe -m uvicorn app.main:app --port 8080  # 后台
cd services/pi-orchestrator && INTERNAL_API_TOKEN=<.env里的值> node src/server.mjs  # 后台
cd frontend/apps/web && pnpm dev  # 后台（若未运行）
```

- [ ] **Step 3: Pi 服务直连冒烟**

```bash
curl -s http://127.0.0.1:8090/health -H "x-internal-token: $TOKEN"
curl -s http://127.0.0.1:8090/sessions -H "x-internal-token: $TOKEN" -H "x-user-id: UADMIN"
```
Expected: `{"status":"ok"}` 与 `{"sessions":[]}`

- [ ] **Step 4: 登录拿 Cookie，走代理发一条闲聊 + 一条问数（SSE）**

```bash
curl -s -c /tmp/cookies.txt -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"admin","password":"<AUTH_ADMIN_PASSWORD>"}'
curl -s -N -b /tmp/cookies.txt -X POST http://localhost:3000/api/assistant/chat/stream \
  -H "Content-Type: application/json" -d '{"message":"你好，你能做什么？"}' | head -20
curl -s -N -b /tmp/cookies.txt -X POST http://localhost:3000/api/assistant/chat/stream \
  -H "Content-Type: application/json" -d '{"message":"各险种的保费规模是多少？"}' | tail -5
```
Expected: 闲聊——done 帧直接有回答、无 tool_call 帧；问数——含 `event: tool_call`（label 含 ask_data）且 done 帧 answer 引用真实数据

- [ ] **Step 5: 浏览器验证灰度开关**

浏览器开 http://localhost:3000/chat → 打开"Pi 编排"开关 → 发问 → 会话列表出现（Pi 存储）→ 关闭开关回到经典问数。截图留档。

- [ ] **Step 6: 收尾报告**

汇总：改动文件清单、测试结果、已知限制（M1 边界）、遗留问题。

---

## Self-Review 记录

- **Spec 覆盖**：M1 清单逐项——orchestrator 骨架（T1-7）、ask_data（T5）、事件协议（T2）、护栏（T4+T6）、Python 代理鉴权/限流/熔断（T8/T10）、internal 接口（T9）、/chat 灰度（T11）、compose 集成（T12）、验收（T13）。✓
- **裁决偏差已声明**：JSONL 自实现 store、失败计数熔断、无文本增量帧、persist=False 反馈禁用、sampleRows ≤10——见文档头"M1 范围裁决"。
- **类型一致性**：uiEvent 字段（id/type/label/detail/timestamp）与前端 AgentEvent 一致；done 帧字段与 AgentRunResult 兼容（sessionId/answer/sql/data/events/toolCalls/durationMs/messageId/error）；`_forward_headers(settings, user)` 在 T10 定义与使用一致；`store.history(userKey, sessionId, limit)` 在 T3 定义、T6 使用一致。

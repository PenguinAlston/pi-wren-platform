# 开源 Pi（earendil-works/pi）接入评估

> 评估日期：2026-08 · 目标：判断能否将 MIT 开源 Agent 工具集
> [`earendil-works/pi`](https://github.com/earendil-works/pi)（pi-ai / pi-agent-core）嵌入本平台。

## 状态：方案 A 已落地（2026-08）

Spike 通过后已完成**会话层接入**（提交见 Git 历史）：

- 新增 `services/pi-bridge`：`PiSessionStore`（pi `JsonlSessionRepo` 持久化多轮会话，`data/sessions/`）、压缩决策辅助、SSE 事件协议
- `DataAnalysisAgent.answer(question, { sessionId, onEvent })`：续聊时注入最近 3 轮历史，执行事件实时回调
- API 新增 `POST /api/agent/:domain/chat/stream`（SSE），前端实时渲染执行轨迹并保持同一会话续聊
- 生产构建修复：tsup 由 ESM 改 CJS（原生 CJS 依赖 pg/yaml 在 ESM bundle 运行时报错）；`resolveSemanticFile` 增加 cwd 向上查找（兼容打包后运行）
- 风险边界保持不变：问答仍走确定性流水线，SQL 校验/降级/防幻觉未改动

## 结论（TL;DR）

**技术可行，Spike 已跑通。** 但建议**不要用 Pi 替换现有确定性 SQL 流水线**，
只在其上有选择地接入「会话记忆 + 事件流」能力，保持 SQL 校验/降级/防幻觉边界不动。

- ✅ pi-agent-core 0.83.0 可直接嵌入（`Agent` 类 + 自定义工具 + 事件订阅）
- ✅ 阿里云 DashScope（OpenAI-completions 兼容）可配置为 pi-ai 自定义 provider，qwen3.7-flash 实测可用
- ✅ 中文多轮会话 + 工具调用 + 流式事件全部正常（单问 ~5s，与现有 LLM 直连相当）
- ⚠️ 依赖体积大（~128MB，pi-ai 捆绑各厂商 SDK）；0.x API 不稳定；Node 要求 ≥22.19（仓库当前 ≥20）

## Spike 验证内容

验证环境：`/tmp/pi-spike`（Node v24.12.0，pnpm 11），锁定版本 0.83.0。

| 验证点 | 结果 |
|---|---|
| 自定义 provider（DashScope OpenAI-completions 兼容端点） | ✅ `createProvider` + `openAICompletionsApi` + `envApiKeyAuth`；注意 `auth` 需包装为 `{ apiKey: ... }` |
| 自定义工具注入（模拟保单查询） | ✅ `AgentTool`（typebox 参数 schema），工具名/描述/参数自动暴露给模型 |
| 事件流 | ✅ `message_update`（文本增量）、`tool_execution_start/end`、`turn_end`、`agent_end` |
| 中文问答 + 工具调用 | ✅ 问"王大力都有哪些保单？" → 自动调用工具 → 结构化中文回答 |
| 多轮会话记忆 | ✅ 追问"他的保费是多少？"直接引用上一轮工具结果（399 元），未重复查库 |
| 会话持久化 | pi-agent-core 提供 jsonl/memory repo（`harness/session/`），可落盘 |

## 技术要点

### 1. Provider 配置（DashScope）

pi-ai 自带 `openaiProvider`，但 baseUrl 硬编码且走 Responses API；
DashScope 兼容模式是 Chat Completions，需用 `createProvider` 自定义：

```ts
import { createModels, createProvider, envApiKeyAuth, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

const provider = createProvider({
  id: "dashscope",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  auth: { apiKey: envApiKeyAuth("DashScope API key", ["OPENAI_API_KEY"]) }, // 注意 { apiKey: } 包装
  models: [{ id: "qwen3.7-flash", api: "openai-completions", /* ... */ }],
  api: { "openai-completions": openAICompletionsApi() },
});
```

### 2. Agent 嵌入（最小样例）

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

const agent = new Agent({
  initialState: {
    systemPrompt: "你是一个保险业务查询助手…",
    model,
    tools: [/* AgentTool[] */],
  },
  streamFn: models.streamSimple.bind(models),
  sessionId: "session-1",
});
agent.subscribe((e) => {
  if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta")
    process.stdout.write(e.assistantMessageEvent.delta);
});
await agent.prompt("王大力都有哪些保单？");
```

### 3. 参考案例

OpenClaw 有真实嵌入案例（openclawx.cloud/en/pi）：`createAgentSession()` +
`customTools` 注入 + `subscribe()` 事件流，并提供了
`AgentTool → ToolDefinition` 签名适配器（`toToolDefinitions`）。

## 风险与边界（必须保留的能力）

1. **自由循环不可控**：Pi 的 Agent 循环由 LLM 决定何时调用工具、调用几次。
   若放开，单问的 LLM 调用次数/成本不可预测（实测 qwen3.7-flash 单轮 20–50s）。
   → 现有确定性流水线（计划 → SQL 生成 → 校验 → 查询 → 摘要）更可控，**不替换**。
2. **SQL 安全**：若走 Pi 的循环，`query_sql` 工具仍必须走现有 `sql-validation`
   （只读/白名单/降级）。工具注册处是唯一入口，可控。
3. **版本与 Node**：0.83.0 要求 Node ≥22.19（`legacy-node20` tag 为 0.74.2 支持 Node 20）。
   仓库 engines 需升至 ≥22.19 或锁 0.74.2。
4. **0.x API 不稳定**：0.74 → 0.83 已有破坏性变化（README/导出结构调整）。
   接入时必须锁死版本，升级需专项回归。
5. **依赖体积**：~128MB（pi-ai 打包多厂商 SDK），建议仅在 API 服务引入，不进 Web bundle。

## 建议的接入方式（若继续）

| 方案 | 说明 | 建议 |
|---|---|---|
| A. 会话层接入（推荐） | 仅用 pi-agent-core 的会话持久化 + 事件协议（SSE 流式输出、上下文压缩），问答仍走确定性流水线 | ⭐ 风险最低，先做 |
| B. 完整 Agent 循环 | 用 `Agent` 编排，工具固定为受控白名单（query_sql 等） | 后续可选，需加调用次数/超时护栏 |
| C. 仅 pi-ai | 只把 LLM 层换成 pi-ai（统一多 provider） | 收益小，不推荐单做 |

实施时建议新增独立 workspace（如 `services/pi-bridge`）封装 provider/Agent 实例化，
保持与 `apps/api/src/deps.ts` 的接线点，避免污染现有 agent-runtime。

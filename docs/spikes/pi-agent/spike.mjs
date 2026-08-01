/**
 * Pi 接入 Spike：验证 pi-agent-core 能否嵌入我们的平台
 * 1. 自定义 DashScope provider（OpenAI-completions 兼容，qwen3.7-flash）
 * 2. 注入一个模拟"保单查询"工具（对应我们的 data-engine）
 * 3. 跑一轮中文问答，观察 工具调用 + 事件流
 */
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  InMemoryCredentialStore,
  Type,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { Agent } from "@earendil-works/pi-agent-core";

const BASE_URL =
  process.env.OPENAI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const API_KEY = process.env.OPENAI_API_KEY ?? "";
const MODEL_ID = process.env.OPENAI_MODEL ?? "qwen3.7-flash";

if (!API_KEY) {
  console.error("缺少 OPENAI_API_KEY");
  process.exit(1);
}

// ---------- 1. DashScope provider（OpenAI-completions 兼容） ----------
const credentials = new InMemoryCredentialStore();
await credentials.modify("dashscope", async () => ({ type: "api_key", key: API_KEY }));

const provider = createProvider({
  id: "dashscope",
  name: "DashScope",
  baseUrl: BASE_URL,
  auth: { apiKey: envApiKeyAuth("DashScope API key", ["OPENAI_API_KEY"]) },
  models: [
    {
      id: MODEL_ID,
      name: MODEL_ID,
      api: "openai-completions",
      provider: "dashscope",
      baseUrl: BASE_URL,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 4096,
    },
  ],
  api: { "openai-completions": openAICompletionsApi() },
});

const models = createModels({ credentials });
models.setProvider(provider);
const model = models.getModel("dashscope", MODEL_ID);
if (!model) throw new Error(`model ${MODEL_ID} not found`);

// ---------- 2. 自定义工具：模拟保单查询（对应 data-engine） ----------
const queryPolicyTool = {
  name: "query_insurance_policy",
  label: "查询保单",
  description: "查询客户名下的保单列表，按客户姓名精确匹配",
  parameters: Type.Object({
    customerName: Type.String({ description: "客户姓名" }),
  }),
  execute: async (_toolCallId, params) => {
    if (params.customerName === "王大力") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify([
              { policyNo: "P20240003", productName: "惠民百万医疗险", status: "承保有效", insuredDate: "2024-05-11", premium: 399 },
            ]),
          },
        ],
        details: { rowCount: 1 },
      };
    }
    return { content: [{ type: "text", text: "[]" }], details: { rowCount: 0 } };
  },
};

// ---------- 3. Agent 实例 + 事件订阅 ----------
const agent = new Agent({
  initialState: {
    systemPrompt:
      "你是一个保险业务查询助手。用户询问保单信息时，必须先调用 query_insurance_policy 工具查询，再基于查询结果组织简洁的中文回答。查无数据则如实说明。",
    model,
    tools: [queryPolicyTool],
  },
  streamFn: models.streamSimple.bind(models),
  sessionId: "spike-1",
});

agent.subscribe((event) => {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        process.stdout.write(event.assistantMessageEvent.delta);
      }
      break;
    case "tool_execution_start":
      console.log(`\n[TOOL] ${event.toolName} args=${JSON.stringify(event.args)}`);
      break;
    case "tool_execution_end":
      console.log(`\n[TOOL-END] ok=${!event.isError}`);
      break;
    case "turn_end":
      console.log(`\n[EVENT] turn_end toolResults=${event.toolResults.length}`);
      break;
    case "agent_end":
      console.log(`\n[EVENT] agent_end messages=${event.messages.length}`);
      break;
  }
});

console.log(`> prompt: 王大力都有哪些保单？  (${MODEL_ID})\n`);
const startedAt = Date.now();
await agent.prompt("王大力都有哪些保单？");
console.log(`\n\n< 完成，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

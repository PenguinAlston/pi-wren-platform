import { createModels, createProvider, envApiKeyAuth, InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { Agent } from "@earendil-works/pi-agent-core";

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
const API_KEY = process.env.OPENAI_API_KEY ?? "";
const MODEL_ID = process.env.OPENAI_MODEL ?? "qwen3.7-flash";

const credentials = new InMemoryCredentialStore();
await credentials.modify("dashscope", async () => ({ type: "api_key", key: API_KEY }));
const provider = createProvider({
  id: "dashscope", name: "DashScope", baseUrl: BASE_URL,
  auth: { apiKey: envApiKeyAuth("DashScope API key", ["OPENAI_API_KEY"]) },
  models: [{ id: MODEL_ID, name: MODEL_ID, api: "openai-completions", provider: "dashscope", baseUrl: BASE_URL, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 }],
  api: { "openai-completions": openAICompletionsApi() },
});
const models = createModels({ credentials });
models.setProvider(provider);
const model = models.getModel("dashscope", MODEL_ID);

const agent = new Agent({
  initialState: {
    systemPrompt: "你是一个保险业务查询助手。询问保单信息时先调用 query_insurance_policy 工具。",
    model,
    tools: [{
      name: "query_insurance_policy", label: "查询保单",
      description: "查询客户名下的保单列表，按客户姓名精确匹配",
      parameters: Type.Object({ customerName: Type.String({ description: "客户姓名" }) }),
      execute: async (_id, p) => ({ content: [{ type: "text", text: JSON.stringify([{ policyNo: "P20240003", productName: "惠民百万医疗险", status: "承保有效", insuredDate: "2024-05-11", premium: 399 }]) }], details: { rowCount: 1 } }),
    }],
  },
  streamFn: models.streamSimple.bind(models),
  sessionId: "spike-session-1",
});

agent.subscribe((e) => {
  if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") process.stdout.write(e.assistantMessageEvent.delta);
});
console.log("> Q1: 王大力有保单吗？"); await agent.prompt("王大力有保单吗？");
console.log("\n> Q2(追问): 他的保费是多少？"); await agent.prompt("他的保费是多少？");
console.log("\n\n< 完成");

# Pi Agent Spike（复现步骤）

验证 `@earendil-works/pi-agent-core` 嵌入本平台的最小样例（评估详见 `docs/pi-integration-assessment.md`）。

## 环境

- Node ≥ 22.19（spike 用 v24 验证；pi-agent-core 0.83.0 要求 ≥22.19）
- 仓库根 `.env` 提供 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`（DashScope 兼容端点）

## 步骤

```bash
mkdir -p /tmp/pi-spike && cd /tmp/pi-spike
pnpm init
pnpm add @earendil-works/pi-agent-core@0.83.0 @earendil-works/pi-ai@0.83.0
cp <repo>/docs/spikes/pi-agent/spike.mjs .
set -a && . <repo>/.env && set +a
node spike.mjs        # 单轮：中文提问 → 工具调用 → 结构化回答
node spike2.mjs       # 多轮：追问引用上一轮工具结果（会话记忆）
```

## 关键坑

1. `createProvider` 的 `auth` 必须包装为 `{ apiKey: envApiKeyAuth(...) }`（ProviderAuth 形状），
   直接传 `envApiKeyAuth(...)` 会导致 "Provider is not configured"。
2. DashScope 兼容端点是 Chat Completions（`openai-completions` API），
   不能用 pi-ai 内置 `openaiProvider()`（走 Responses API 且 baseUrl 硬编码）。
3. pnpm 11 在无 `pnpm-workspace.yaml` 的目录会触发 `verifyDepsBeforeRun` 依赖自检，
   直接用 `node` 运行脚本即可绕过。

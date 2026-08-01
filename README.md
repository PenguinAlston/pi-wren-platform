# pi-wren-platform

基于 **Pi Agent Runtime**（智能体执行层）与 **Wren Context Engine**（企业语义上下文层）的企业级自然语言数据分析平台。用户用自然语言向企业数据提问，平台自动完成：业务理解 → 语义层生成 SQL → 数据查询 → 结果分析 → 执行摘要。

## 快速开始

前置要求：Node.js ≥ 20、pnpm ≥ 10、Docker。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地基础设施（PostgreSQL + Redis，使用本机已有镜像）
docker compose up -d

# 3. 启动 API (8080) 与 Web (3000)
pnpm dev
```

打开 <http://localhost:3000/chat>，尝试提问：

```
为什么利润下降？
本季度收入趋势如何？
```

默认使用 `mock` LLM（离线确定性分析）与 `demo` 语义层，无需任何外部服务即可跑通全链路。接入真实 LLM / Wren AI 见下方配置。

## 架构

```
用户
 │
Web Chat (Next.js, :3000)  ──/api 代理──►  API Gateway (Express, :8080)
                                             │
                                        Finance Agent
                                             │
                     ┌───────────────────────┼───────────────────────┐
                     │                       │                       │
              Wren Context Engine      Agent Tools             PostgreSQL
              (语义层/SQL 生成)     (工具注册与执行)            (数据引擎)
                     │                       │
              Wren AI 服务 / Demo       LLM Provider (OpenAI/Anthropic/Ollama/Mock)
```

## 环境变量

复制 `.env.example` 并按需配置（API 服务读取）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | API 端口 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `piwren` / `demo` / `demo` | PostgreSQL 连接 |
| `LLM_PROVIDER` | `mock` | `mock` \| `openai` \| `anthropic` \| `ollama` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | - / `gpt-4o-mini` | OpenAI 兼容接口（含 DeepSeek 等） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | - / `claude-3-5-haiku-latest` | Anthropic |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `qwen2.5:7b` | 本地 Ollama |
| `WREN_URL` / `WREN_TOKEN` | - | 配置后启用真实 Wren AI 服务，否则使用 demo 语义层 |

## 常用命令

```bash
pnpm dev          # 并行启动所有 workspace（开发模式）
pnpm build        # 构建所有 workspace（API 打包 + Web 静态构建）
pnpm lint         # ESLint 检查
pnpm typecheck    # TypeScript 类型检查
pnpm test         # Vitest 单元/集成测试
```

## 项目结构

```
apps/
  api/     Express API 服务（配置校验、日志、健康检查、chat 路由）
  web/     Next.js 聊天控制台（分析结论、执行轨迹、SQL、结果表）
services/
  agent-runtime/   智能体执行（计划、工具注册、事件、记忆、FinanceAgent）
  context-engine/  Wren 语义层（Wren AI 客户端 + demo SQL 生成 + 指标定义）
  data-engine/     PostgreSQL 数据引擎（连接池、SQL 执行）
packages/
  agent-sdk/       LLM Provider 抽象（OpenAI / Anthropic / Ollama / Mock）
  shared-types/    跨服务共享类型
infra/postgres/    建表与种子数据 (init.sql)
docs/              架构说明、进展与路线图
```

## 测试

```bash
pnpm test   # 20+ 个用例：LLM provider、SQL 生成、结果分析、FinanceAgent 流水线、API 集成
```

## 路线图

见 [docs/enterprise-roadmap.md](docs/enterprise-roadmap.md)：包含已完成的工程化改造与后续企业级能力（认证/RBAC、Redis 记忆、流式输出、可观测性、容器化部署等）。

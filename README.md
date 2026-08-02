# pi-wren-platform

基于 **Pi Agent Runtime**（智能体执行层）与 **Wren Context Engine**（企业语义上下文层）的企业级自然语言数据分析平台。用户用自然语言向企业数据提问，平台自动完成：业务理解 → 语义层生成 SQL（安全校验）→ 数据查询 → 结果分析 → 执行摘要。

## 核心能力

- **自然语言查数**：中文提问 → LLM 动态生成 SQL（规则引擎兜底）→ 只读安全校验 → PostgreSQL 查询 → 防幻觉业务摘要
- **多 Agent 开箱即用**：财务分析、保险综合查询（22 张生产级业务表 + 字典中文标签）
- **自定义 Agent（自助注册）**：用户提供一份 MDL + 数据库连接串，即可注册专属查询 Agent，无需改代码/重启
- **多轮会话**：基于开源 Pi jsonl 会话仓库持久化（重启不丢），续聊自动注入历史
- **SSE 流式输出**：执行事件实时推送，前端实时渲染轨迹
- **企业治理**：管理操作审计落库（sys_operation_log）、连接串 AES-256-GCM 加密、多租户 owner_id、连接池监控、SQL 表名白名单注册即隔离

## 快速开始

前置要求：Node.js ≥ 22.19、pnpm ≥ 10、Docker。

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地基础设施（PostgreSQL + Redis）
docker compose up -d

# 3. 启动 API (8080) 与 Web (3000)
pnpm dev
```

打开 <http://localhost:3000/chat> 提问（如"为什么利润下降？"）；自定义 Agent 管理入口在 <http://localhost:3000/agents>（需 `.env` 中的 `ADMIN_TOKEN`）。

默认使用 `mock` LLM（离线确定性分析）与 MDL 式语义层（`semantic/*.mdl.yml`），无需外部服务即可跑通全链路。

## 架构

```
用户
 │
Web (:3000) ──/api 代理──►  Express API (:8080)
 │   /chat 聊天控制台            ├─ GET /api/agents
 │   /agents 自定义 Agent 管理   ├─ POST /api/agent/:domain/chat（JSON / SSE 流式）
 │                              └─ /api/admin/agents*（X-Admin-Token）
 │
 ├─ services/pi-bridge        开源 Pi 会话层：jsonl 多轮持久化 + 压缩决策 + SSE 协议
 ├─ services/agent-registry   自定义 Agent 注册表：sys_agent_config + AES 加密 + 审计
 │
DataAnalysisAgent（领域配置驱动：内置 财务/保险 + 自定义）
 │
 ├─ 语义层 ContextEngine：LlmContextEngine（LLM 动态 SQL）⇄ ConfigDrivenContextEngine（规则兜底）
 │    └─ 安全校验 sql-validation：统一关口 + 去注释/危险函数拦截 + 表名白名单（来自 MDL）
 ├─ Agent Tools：wren_generate_sql / database_query / result_analysis / wren_search_knowledge / llm_summarize
 │
 └─ 数据引擎 SqlExecutor → PostgreSQL（内置表 + 自定义 Agent 独立连接池）
```

## 环境变量

复制 `.env.example` 并按需配置（API 服务读取）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | API 端口 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `piwren` / `demo` / `demo` | PostgreSQL 连接 |
| `LLM_PROVIDER` | `mock` | `mock` \| `openai` \| `anthropic` \| `ollama` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | - | OpenAI 兼容接口（含阿里云 DashScope 等） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | - | Anthropic |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `qwen2.5:7b` | 本地 Ollama |
| `WREN_URL` / `WREN_TOKEN` | - | 配置后启用真实 Wren AI 服务 |
| `SEMANTIC_DIR` | `semantic/` | 语义配置目录覆盖（可选） |
| `SESSION_DIR` | `data/sessions` | 会话 jsonl 持久化目录 |
| `ADMIN_TOKEN` | - | 自定义 Agent 管理面鉴权（`X-Admin-Token`） |
| `AGENT_SECRET_KEY` | - | 连接串加密密钥（≥8 字符，建议 ≥32 字节；**配置后才启用自定义 Agent**） |
| `AUDIT_USER_ID` | `UADMIN` | 管理操作审计主体（sys_user.user_id） |

## 常用命令

```bash
pnpm dev          # 并行启动所有 workspace（开发模式）
pnpm build        # 构建所有 workspace（API 打包 + Web 静态构建）
pnpm lint         # ESLint 检查
pnpm typecheck    # TypeScript 类型检查
pnpm test         # Vitest 单元/集成测试（92 个用例）
```

## 项目结构

```
apps/
  api/     Express API（配置校验、日志、健康检查、chat/SSE 路由、自定义 Agent 管理 API、连接池管理）
  web/     Next.js 聊天控制台（app/chat）+ 自定义 Agent 管理页（app/agents）
services/
  agent-runtime/    Agent 执行（计划、工具注册、事件、记忆、DataAnalysisAgent、LLM SQL 生成与校验）
  context-engine/   Wren 语义层（Wren AI 客户端 + MDL 式配置驱动引擎）
  data-engine/      PostgreSQL 数据引擎（连接池、SQL 执行、语句超时）
  pi-bridge/        开源 Pi 会话层（jsonl 多轮持久化、压缩决策、SSE 协议）
  agent-registry/   自定义 Agent 注册表（sys_agent_config、AES 加密、审计、生命周期管理）
packages/
  agent-sdk/        LLM Provider 抽象（OpenAI 兼容 / Anthropic / Ollama / Mock）
  shared-types/     跨服务共享类型
semantic/           MDL 式语义配置（finance.mdl.yml / insurance.mdl.yml）
examples/           mdl-template.yml（自定义 Agent 模板）
infra/postgres/     建表与种子数据（insurance_schema/insurance_seed/agent_config/z_admin_seed）
docs/               架构、进展、路线图与设计文档
```

## API 端点

- `GET /api/agents` — Agent 列表（内置 + 自定义，含 source）
- `POST /api/agent/chat`、`POST /api/agent/:domain/chat` — 问答（支持 `sessionId` 续聊）
- `POST /api/agent/:domain/chat/stream` — SSE 流式版（执行事件实时推送）
- 自定义 Agent 管理面（`X-Admin-Token`；网页入口 `/agents`）：
  - `POST /api/admin/agents` — 注册（MDL + 连接串，AES 加密落库，支持 `ownerId`）
  - `GET /api/admin/agents`（`?ownerId=` 过滤）、`GET /api/admin/agents/:id` — 查询（连接脱敏）
  - `PUT /api/admin/agents/:id`（含启停）、`DELETE /api/admin/agents/:id` — 更新/注销
  - `POST /api/admin/agents/test`、`POST /api/admin/agents/:id/test` — 连接测试
  - `POST /api/admin/agents/validate` — 仅校验 MDL
  - `GET /api/admin/agents/:id/status` — 运行状态 + 连接池监控
  - 管理操作自动写 `sys_operation_log` 审计；模板见 `examples/mdl-template.yml`
- `GET /health` — 健康检查

## 测试

92 个 Vitest 用例：LLM Provider、SQL 校验（含对抗性用例）、意图匹配、Agent 流水线、会话持久化、注册表/加密/审计、自定义 Agent 管理 API 集成（端口监听需本机授权）。

## 文档导航

- [docs/technical-architecture.md](docs/technical-architecture.md) — 技术架构（结果版，分层图/模块表/数据流）
- [docs/architecture.md](docs/architecture.md) — 架构演进说明
- [docs/enterprise-roadmap.md](docs/enterprise-roadmap.md) — 企业级路线图与待办
- [docs/mvp-progress.md](docs/mvp-progress.md) — MVP 进展
- [docs/custom-agent-design.md](docs/custom-agent-design.md) — 自定义 Agent 功能设计
- [docs/pi-integration-assessment.md](docs/pi-integration-assessment.md) — 开源 Pi 接入评估

# 仓库指南

`pi-wren-platform` 贡献者指南：一个用 LLM 生成 SQL、对真实数据库进行自然语言业务问答的企业级 Agent 平台（融合 Pi Agent Runtime 执行层与 Wren 风格语义上下文层）。

## 项目结构与模块划分

pnpm workspace 单仓（`pnpm-workspace.yaml`），全 TypeScript。每个 workspace 各司其职：

- `apps/api` — Express API：zod 配置校验、pino 日志、健康检查、`/api/agents`、`/api/agent/:domain/chat`、`/api/agent/:domain/chat/stream`（SSE 流式，`src/routes/`）
- `apps/web` — Next.js 聊天控制台（`app/chat/`）+ 自定义 Agent 管理页（`app/agents/`）：MDL 粘贴、连接测试、注册/启停/编辑/删除、池监控
- `services/agent-runtime` — Agent 执行：计划、工具注册、事件、记忆、领域驱动的 `DataAnalysisAgent`（`src/agents/`，支持 `sessionId` 续聊 + `onEvent` 流式回调）；LLM 动态 SQL 生成与安全校验（`src/context/`）
- `services/pi-bridge` — 开源 Pi 会话层（方案 A）：基于 `@earendil-works/pi-agent-core` 的 jsonl 多轮会话持久化（`PiSessionStore`）、压缩决策、SSE 事件协议（`src/`）
- `services/agent-registry` — 自定义 Agent 注册表：`sys_agent_config` 持久化、连接串 AES-256-GCM 加密（`crypto.ts`）、运行时动态加载/更新/注销与错误隔离（`registry.ts`、`store.ts`）
- `services/context-engine` — 语义层：Wren AI 客户端（`src/wren/`）、MDL 式配置驱动引擎（`src/mdl/`）
- `services/data-engine` — PostgreSQL 连接池与 SQL 执行器（`src/`）
- `packages/agent-sdk` — LLM Provider（OpenAI 兼容 / Anthropic / Ollama / Mock）（`src/providers/`）
- `packages/shared-types` — 跨服务共享类型（`src/index.ts`）
- `semantic/` — MDL 式 YAML 语义配置（`finance.mdl.yml`、`insurance.mdl.yml`）：模型/意图/指标/知识
- `infra/postgres` — 建表与种子数据（`insurance_schema.sql`、`insurance_seed.sql`、`agent_config.sql` 自定义 Agent 表、`z_admin_seed.sql` 审计主体）；`examples/mdl-template.yml` — 自定义 Agent 模板；`docs` — 架构与路线图

各部分如何协作：**新增一个 Agent = 新增一段领域配置（`src/agents/domain.ts`）+ 一份语义 YAML（内置），或通过管理 API/前端页面上传 MDL + 数据库连接串（自定义，`services/agent-registry`），流水线代码零改动**。所有业务依赖均通过构造函数注入，便于测试替换替身。

## 构建、测试与开发命令

在仓库根目录执行：

- `pnpm install` — 安装依赖（CI 用 `--frozen-lockfile`；pnpm 11 的构建白名单见 `pnpm-workspace.yaml` 的 `allowBuilds`）
- `pnpm dev` — 并行启动 API（:8080）与 Web（:3000）。**不要在 dev 运行时执行 `pnpm build`**（两者共用 `.next` 缓存会冲突）
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — 构建、Lint、类型检查、运行 Vitest（92 个用例；API 集成测试需可监听本地端口）
- `docker compose up -d` — 启动 PostgreSQL/Redis（使用本机镜像，见 `docker-compose.yml`）
- 配置：在仓库根创建 `.env`（参考 `.env.example`），API 通过 dotenv 自动加载；`LLM_PROVIDER`（`mock|openai|anthropic|ollama`）切换离线规则模式与 LLM 动态 SQL 模式；`SESSION_DIR` 可覆盖会话存储目录（默认 `data/sessions`，已 gitignore）；`ADMIN_TOKEN`（管理面鉴权）+ `AGENT_SECRET_KEY`（连接串加密密钥，配置后才启用自定义 Agent）

## 编码风格与命名约定

- TypeScript，2 空格缩进，分号，单引号（Prettier 强制）
- strict 模式、`verbatimModuleSyntax`（类型导入用 `import type`）、`noUncheckedIndexedAccess`
- 形状用 `interface`，服务用小类；文件名 kebab-case（`sql-runner.ts`），函数/变量 camelCase
- 环境配置用 zod 校验（`apps/api/src/config.ts`）；语义 YAML 由 `src/mdl/loader.ts` 校验

## 测试指南

- Vitest；测试与源码同目录，命名 `*.test.ts`
- 按行为命名：`describe('LlmContextEngine')` + `it('falls back when the LLM returns a dangerous statement')`
- 覆盖：Provider 客户端（mock `fetch`）、SQL 校验、意图匹配、Agent 流水线（注入替身）、会话持久化（pi jsonl）、注册表/加密/审计、自定义 Agent 管理 API（临时端口集成测试）

## 提交与 PR 指南

- Conventional Commits，小写祈使句：`feat: add llm-powered sql generation`、`fix: raise proxy timeout for slow llm`
- 每次提交一个逻辑变更；PR 面向 `main`，关联 issue、说明"改了什么/为什么"、列出手工验证步骤，UI 变更附截图

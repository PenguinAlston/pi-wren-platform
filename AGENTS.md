# 仓库指南

`pi-wren-platform` 贡献者指南：一个用 LLM 生成 SQL、对真实数据库进行自然语言业务问答的企业级 Agent 平台。融合 Pi Agent Runtime（执行层）与 WrenAI（受治理语义上下文层），语义层完全基于 WrenAI 原生工程。

## 项目结构与模块划分

pnpm workspace 单仓（`pnpm-workspace.yaml`），全 TypeScript。每个 workspace 各司其职：

- `apps/api` — Express API：zod 配置校验、pino 日志、健康检查、`/api/agents`、`/api/agent/:domain/chat`、`/api/agent/:domain/chat/stream`（SSE 流式，`src/routes/`）
- `apps/web` — Next.js 聊天控制台（`app/chat/`）+ 自定义 Agent 管理页（`app/agents/`）：WrenAI 工程 JSON 粘贴、连接测试、注册/启停/编辑/删除、池监控
- `services/agent-runtime` — Agent 执行：计划、工具注册、事件、记忆、领域驱动的 `DataAnalysisAgent`（`src/agents/`，支持 `sessionId` 续聊 + `onEvent` 流式回调）；`WrenCliContextEngine`（唯一语义层实现，`src/context/`）+ SQL 安全校验（`allowedTables` 白名单）
- `services/pi-bridge` — 开源 Pi 会话层：基于 `@earendil-works/pi-agent-core` 的 jsonl 多轮会话持久化（`PiSessionStore`）、压缩决策、SSE 事件协议（`src/`）
- `services/agent-registry` — 自定义 Agent 注册表：`sys_agent_config` 持久化（`project_json` 列）、连接串 AES-256-GCM 加密（`crypto.ts`）、运行时动态加载/更新/注销与错误隔离（`registry.ts`、`store.ts`）
- `services/context-engine` — 语义层：WrenAI CLI 子进程适配器 `WrenCli`（`src/wren/cli.ts`）+ WrenAI 工程加载器 `loadWrenProject`（`src/wren/project-loader.ts`，提取表名白名单与 NL→SQL 示例）
- `services/data-engine` — PostgreSQL 连接池与 SQL 执行器（`src/`）
- `packages/agent-sdk` — LLM Provider（OpenAI 兼容 / Anthropic / Ollama / Mock）（`src/providers/`）
- `packages/shared-types` — 跨服务共享类型（`src/index.ts`）
- `semantic/wren/` — WrenAI 原生语义工程（schema_version 5）：`wren_project.yml` + `models/*/metadata.yml` + `relationships.yml` + `knowledge/{rules,sql}/`（单一语义源，不再有自研 MDL）
- `scripts/wren-e2e-check.ts` — 端到端验证脚本：真实 wren CLI + 真实保险库 + 真实 LLM 走 `WrenCliContextEngine`
- `infra/postgres` — 建表与种子数据（`insurance_schema.sql`、`insurance_seed.sql`、`agent_config.sql` 自定义 Agent 表、`z_admin_seed.sql` 审计主体）；`examples/wren-project-template.json` — 自定义 Agent 工程模板；`docs` — 架构与路线图

各部分如何协作：**新增一个 Agent = 新增一段领域配置（`src/agents/domain.ts`）+ 一份 WrenAI 工程（内置 `semantic/wren/`），或通过管理 API/前端页面上传 WrenAI 工程 JSON + 数据库连接串（自定义，`services/agent-registry`），流水线代码零改动**。所有业务依赖均通过构造函数注入，便于测试替换替身。

## 语义层：WrenAI 原生工程（唯一源）

平台完全拥抱 WrenAI，语义层只有一种格式——WrenAI 原生工程（`semantic/wren/`）。问答链路：

1. `WrenCli.memory fetch -q` 检索相关语义上下文 + `WrenCli.context instructions` 注入业务规则
2. LLM（受治理提示词）生成 SQL
3. `WrenCli.dry-run --sql` 受治理校验（解析 + 合法 + 仅工程内表）
4. 本地 `parseAndValidateSql` 二次校验（表名白名单来自 `loadWrenProject` 提取的 `table_reference.table`）
5. 执行 + 分析 + LLM 防幻觉摘要

**注意**：完全拥抱 WrenAI 后不再有确定性规则兜底（`ConfigDrivenContextEngine` 与自研 MDL 已移除）。LLM 不可用或 dry-run 不通过时问答失败并返回错误，因此 `LLM_PROVIDER` 必须为真实 provider（不能为 `mock`）。

- `WrenCli`（`services/context-engine/src/wren/cli.ts`）— 子进程适配器，execFile 数组参数（不经 shell）
- `WrenCliContextEngine`（`services/agent-runtime/src/context/wren-cli-context-engine.ts`）— 唯一语义引擎实现
- 启用条件：`.env` 配置 `WREN_BIN`（如 `wren`）且 Wren 工程就绪（`WREN_PROJECT_DIR`，默认解析 `semantic/wren`）
- 服务器部署需：`pip install 'wrenai[postgres,memory]'`（国内源 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）、`HF_ENDPOINT=https://hf-mirror.com`（memory index 下载 embedding 模型）、在 `semantic/wren` 下 `wren context build && wren memory index`

## 构建、测试与开发命令

在仓库根目录执行：

- `pnpm install` — 安装依赖（CI 用 `--frozen-lockfile`；pnpm 11 的构建白名单见 `pnpm-workspace.yaml` 的 `allowBuilds`）
- `pnpm dev` — 并行启动 API（:8080）与 Web（:3000）。**不要在 dev 运行时执行 `pnpm build`**（两者共用 `.next` 缓存会冲突）
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — 构建、Lint、类型检查、运行 Vitest
- `docker compose up -d` — 启动 PostgreSQL/Redis（使用本机镜像，见 `docker-compose.yml`）
- 配置：在仓库根创建 `.env`（参考 `.env.example`），API 通过 dotenv 自动加载；`LLM_PROVIDER`（`openai|anthropic|ollama`）必配为真实 provider；`WREN_BIN` + `WREN_PROJECT_DIR`（WrenAI CLI 开关）；`SESSION_DIR` 可覆盖会话存储目录（默认 `data/sessions`，已 gitignore）；`ADMIN_TOKEN`（管理面鉴权）+ `AGENT_SECRET_KEY`（连接串加密密钥，配置后才启用自定义 Agent）

## 编码风格与命名约定

- TypeScript，2 空格缩进，分号，单引号（Prettier 强制）
- strict 模式、`verbatimModuleSyntax`（类型导入用 `import type`）、`noUncheckedIndexedAccess`
- 形状用 `interface`，服务用小类；文件名 kebab-case（`sql-runner.ts`），函数/变量 camelCase
- 环境配置用 zod 校验（`apps/api/src/config.ts`）；WrenAI 工程格式由 WrenAI CLI 自身校验

## 测试指南

- Vitest；测试与源码同目录，命名 `*.test.ts`
- 按行为命名：`describe('WrenCliContextEngine')` + `it('throws when wren dry-run rejects the generated SQL')`
- 覆盖：Provider 客户端（mock `fetch`）、SQL 校验（对抗性用例）、Agent 流水线（注入替身）、会话持久化（pi jsonl）、注册表/加密/审计、自定义 Agent 管理 API（临时端口集成测试）、WrenAI 工程加载器（`project-loader`）

## 提交与 PR 指南

- Conventional Commits，小写祈使句：`feat: add llm-powered sql generation`、`fix: raise proxy timeout for slow llm`
- 每次提交一个逻辑变更；PR 面向 `main`，关联 issue、说明"改了什么/为什么"、列出手工验证步骤，UI 变更附截图

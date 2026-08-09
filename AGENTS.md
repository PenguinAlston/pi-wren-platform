# 仓库指南

`pi-wren-platform` 贡献者指南：一个用 LLM 生成 SQL、对真实数据库进行自然语言业务问答的企业级 Agent 平台。融合 WrenAI（受治理语义上下文层）与 LangChain/LangGraph 编排，语义层完全基于 WrenAI 原生工程。

## 项目结构与模块划分

混合技术栈单仓：**后端为 Python（`backend/`，FastAPI），前端为 TypeScript（`apps/web`，Next.js，由 pnpm workspace 管理）**。

- `backend/` — Python 后端（FastAPI + WrenAI 进程内 SDK + LangChain/LangGraph）：健康检查、`/api/agents`、`/api/agent/{domain}/chat`、`/api/agent/{domain}/chat/stream`（SSE 流式）、自定义 Agent 管理（`app/routers/`）、语义层（`app/semantic/`）、注册表/加密/审计（`app/registry/`）、数据层（`app/data/db.py`，asyncpg）
- `apps/web` — Next.js 聊天控制台（`app/chat/`）+ 自定义 Agent 管理页（`app/agents/`）：WrenAI 工程 JSON 粘贴、连接测试、注册/启停/编辑/删除、池监控；通过 `next.config.ts` 把 `/api/*` 代理到 `:8080` 后端
- `packages/shared-types` — 前端共享类型（`src/index.ts`）；后端不消费
- `semantic/wren/` — WrenAI 原生语义工程（schema_version 5）：`wren_project.yml` + `models/*/metadata.yml` + `relationships.yml` + `knowledge/{rules,sql}/`（单一语义源）
- `infra/postgres` — 建表与种子数据（`insurance_schema.sql`、`insurance_seed.sql`、`agent_config.sql` 自定义 Agent 表、`z_admin_seed.sql` 审计主体）；`examples/wren-project-template.json` — 自定义 Agent 工程模板；`docs` — 架构与路线图

各部分如何协作：**新增一个内置 Agent = 在 `backend/app/agents/domain.py` 加一段领域配置 + 一份 WrenAI 工程（`semantic/wren/`）；新增一个自定义 Agent = 通过管理页/API 上传 WrenAI 工程 JSON + 数据库连接串（`backend/app/registry/` 持久化加密），或直接点"从数据库导入"由内省自动生成工程 JSON，流水线代码零改动**。

## 语义层：WrenAI 原生工程（唯一源）

平台完全拥抱 WrenAI，语义层只有一种格式——WrenAI 原生工程（`semantic/wren/`）。问答链路（Python 后端实现）：

1. WrenAI 语义检索相关上下文 + 注入业务规则（`backend/app/semantic/`）
2. LLM（受治理提示词，LangChain/LangGraph 编排）生成 SQL
3. WrenAI 受治理校验（解析 + 合法 + 仅工程内表）
4. `app/semantic/sql_validation.py` 二次校验（表名白名单来自 `mdl_loader.load_allowed_tables`）
5. 执行 + 分析 + LLM 防幻觉摘要

- `WrenEngine`（`backend/app/semantic/wren_engine.py`）— WrenAI 进程内引擎，读 `semantic/wren/target/mdl.json`
- `mdl_loader`（`backend/app/semantic/mdl_loader.py`）— 提取表名白名单
- 启用条件：`.env` 配置 `WREN_PROJECT_DIR`（默认解析 `semantic/wren`），且 `semantic/wren` 已 `wren context build`
- 服务器部署需：`pip install 'wrenai[postgres,memory]'`（国内源 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）、`HF_ENDPOINT=https://hf-mirror.com`（memory index 下载 embedding 模型）、在 `semantic/wren` 下 `wren context build && wren memory index`

## 从数据库导入（自定义 Agent 快捷方式）

管理页"从数据库导入"按钮：给定数据库连接 + schema（+ 可选中文描述），后端内省 `information_schema` + `pg_catalog` 自动生成 WrenAI 工程 JSON，回填到表单供用户校验后注册。

- 内省逻辑：`backend/app/semantic/db_introspect.py`（`introspect_database` / `build_mdl` / `parse_description_map`）
- 端点：`POST /api/admin/agents/import-from-db`（`backend/app/routers/admin_agents.py`，纯生成、不落库）

## 构建、测试与开发命令

后端（Python，在 `backend/` 目录）：

- `pip install -e backend[dev]`（或 `pip install -e '.[dev]'` 在 `backend/` 内）— 安装依赖（国内源 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）
- `uvicorn app.main:app --port 8080 --reload`（在 `backend/` 内）— 启动 API（:8080）
- `pytest backend/tests`（或 `pytest` 在 `backend/` 内）— 运行测试
- 配置：仓库根 `.env`（参考 `.env.example`），后端用 pydantic-settings 自动加载；`LLM_PROVIDER`（`openai|anthropic|ollama`）必配为真实 provider；`ADMIN_TOKEN`（管理面鉴权）+ `AGENT_SECRET_KEY`（连接串加密密钥，配置后才启用自定义 Agent）

前端（TypeScript，在仓库根）：

- `pnpm install` — 安装依赖（CI 用 `--frozen-lockfile`；pnpm 11 的构建白名单见 `pnpm-workspace.yaml` 的 `allowBuilds`）
- `pnpm dev` 或 `pnpm dev:web` — 启动 Web（:3000）。**注意：`pnpm dev` 现在只起前端，后端需单独 `uvicorn` 起**。不要在 dev 运行时执行 `pnpm build`（`.next` 缓存冲突）
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — 前端构建/Lint/类型检查/测试

基础设施：

- `docker compose up -d` — 启动 PostgreSQL/Redis（见 `docker-compose.yml`）

## 编码风格与命名约定

后端（Python）：4 空格缩进；模块 snake_case（`db_introspect.py`），函数/变量 snake_case，类 PascalCase；类型注解（`from __future__ import annotations`）；FastAPI 路由 + asyncpg 异步；pydantic-settings 校验环境配置。

前端（TypeScript，仅 `apps/web`）：2 空格缩进，分号，单引号（Prettier 强制）；strict 模式、`verbatimModuleSyntax`、`noUncheckedIndexedAccess`；文件名 kebab-case，函数/变量 camelCase。

## 测试指南

后端：pytest + pytest-asyncio（`asyncio_mode = "auto"`），测试在 `backend/tests/`，命名 `test_*.py`；纯函数测试（`test_result_analysis.py`、`test_db_introspect.py`、`test_sql_validation.py`、`test_crypto.py`）+ jsonl 会话存储测试（`test_jsonl_store.py`）。内省组装逻辑用纯函数测（喂固定 rows），DB 查询部分不测（项目无 DB fixture）。

前端：Vitest（如 `apps/web` 有 `*.test.ts`）。

## 提交与 PR 指南

- Conventional Commits，小写祈使句：`feat: add db introspection import`、`fix: drop ts backend, unify on python`
- 每次提交一个逻辑变更；PR 面向 `main`，关联 issue、说明"改了什么/为什么"、列出手工验证步骤，UI 变更附截图

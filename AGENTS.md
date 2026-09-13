# 仓库指南

`pi-wren-platform` 贡献者指南：一个用 LLM 生成 SQL、对真实数据库进行自然语言业务问答的企业级 Agent 平台。融合 WrenAI（受治理语义上下文层）+ LangChain/LangGraph 编排（Python 后端）+ **Pi（earendil-works/pi）多工具 Agent 编排层（Node sidecar）**，语义层完全基于 WrenAI 原生工程。

## 项目结构与模块划分

混合技术栈单仓：**后端为 Python（`backend/`，FastAPI），编排层为 Node（`services/pi-orchestrator`），前端为 TypeScript（`frontend/`，pnpm workspace：`apps/web` Next.js + `packages/shared-types`）**。

- `backend/` — Python 后端（FastAPI + WrenAI 进程内 SDK + LangChain/LangGraph）：
  - 问数链路：`/api/agents`、`/api/agent/{domain}/chat`、`/api/agent/{domain}/chat/stream`（SSE，token 级流式）
  - Pi 编排代理：`app/routers/assistant.py`（`/api/assistant/*` → pi-orchestrator，熔断 + 健康探测降级）；`app/routers/internal.py`（`/internal/*`，internal token 鉴权，供编排层回调问数/传统查询/图谱）
  - 知识图谱：`app/graph/`（AGE 图服务 + `app/routers/graph.py`，`/api/graph/overview|neighbors|stats`，org 模式 BFS 子图过滤）
  - 语义层：`app/semantic/`（WrenEngine、mdl_loader、`embedding_retriever.py` 远程向量检索、`org_scope.py` SQL AST 级机构强制）
  - 平台能力：认证与用户/机构管理（`app/auth/`）、自定义 Agent 注册表/加密/审计（`app/registry/`）、限流（`app/ratelimit.py`）、指标（`app/metrics.py`）、反馈（`app/feedback/`）、数据层（`app/data/db.py`，asyncpg）
- `services/pi-orchestrator/` — Node 22 sidecar（`@earendil-works/pi-agent-core` 0.83.0 + `pi-ai`）：Agent 循环 + 三个受控工具（`ask_data` 问数 / `traditional_query` 清单查询 / `graph_query` 图谱），工具经 internal API 带用户身份回调 Python 后端；SSE 输出（`answer_delta` token 级 + plan/tool_call/tool_result/done）；护栏（单轮工具 ≤8 次、175s 总时长、120s 工具超时）；会话存储 PG/JSONL 可切换（`PI_SESSION_BACKEND`）；`protocol/events.schema.json` 为事件契约（ajv 校验）
- `frontend/apps/web` — Next.js 控制台：对话式首页（`app/page.tsx` + `AssistantHome.tsx`，Pi 优先入口）、经典问数 `/chat`、传统查询 `/query`、知识图谱可视化 `/graph`（ECharts 力导向，Neo4j Browser 风格）、自定义 Agent 管理 `/agents`、用户管理 `/users`；Material 3 风格组件库（`app/components/ui/`）；`next.config.ts` 把 `/api/*` 代理到 `:8080`
- `frontend/packages/shared-types` — 前端共享类型（`src/index.ts`）；后端不消费
- `semantic/wren/` — WrenAI 原生语义工程（schema_version 5）：`wren_project.yml` + `models/*/metadata.yml` + `relationships.yml` + `knowledge/{rules,sql}/`（单一语义源）
- `infra/` — `postgres/` 建表与种子数据（业务表、认证、自定义 Agent 表、`zz_graph_init.sql` AGE 图谱装载）；`age-postgres.Dockerfile`（PG18 + AGE 1.7.0 生产镜像）；`load_graph_age17.py`（bind 协议图谱装载器）；`docs/` 架构图与路线图
- `docker-compose.prod.yml` — 生产编排：postgres（AGE 镜像）/ redis / backend / web / pi-orchestrator

各部分如何协作：**新增一个内置 Agent = 在 `backend/app/agents/domain.py` 加一段领域配置 + 一份 WrenAI 工程（`semantic/wren/`）；新增一个自定义 Agent = 通过管理页/API 上传 WrenAI 工程 JSON + 数据库连接串（`backend/app/registry/` 持久化加密），或"从数据库导入"内省自动生成，流水线代码零改动；给 Pi 编排层加新工具 = `services/pi-orchestrator/src/tools/` 加一个工具 + `backend/app/routers/internal.py` 加对应内部端点**。

## 问答链路：Pi 编排为主入口，经典流水线为底座

**主链路（对话式首页 / `/chat` 的 Pi 模式）**：前端 → 后端 `/api/assistant/*` 代理（熔断 + 5s 健康探测恢复）→ pi-orchestrator `POST /sse` → Pi Agent 循环选择工具 → 工具经 internal API（`x-internal-token` + `x-user-id` 身份反查）回到 Python 后端执行 → 后端负责语义检索/SQL 生成校验/执行/图谱查询（全部治理边界在 Python 侧）→ SSE 流式回传（`answer_delta` token 级）。会话归属与历史由编排层注入。

**经典链路（`/api/agent/{domain}/chat`）**：

1. WrenAI 语义检索上下文 + 注入业务规则（`backend/app/semantic/`，三级降级：远程 embedding → 本地 WrenMemory → MDL 直读）
2. LLM（受治理提示词）生成 SQL
3. WrenAI 受治理校验 + `app/semantic/sql_validation.py` 表名白名单二次校验
4. 执行 + 分析 + LLM 防幻觉摘要，SSE 实时轨迹

**机构行级权限（全链路生效）**：`OrgAccess` 三态（admin=不限 / org=机构覆盖 / deny=403），问数走 SQL AST 强制（`org_scope.py`），传统查询走机构覆盖，图谱走 BFS 子图过滤。

- `WrenEngine`（`backend/app/semantic/wren_engine.py`）— WrenAI 进程内引擎，读 `semantic/wren/target/mdl.json`
- 启用条件：`.env` 配置 `WREN_PROJECT_DIR`（默认解析 `semantic/wren`），且 `semantic/wren` 已 `wren context build`
- 部署依赖：`pip install 'wrenai[postgres,memory]'`（国内源 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）、`semantic/wren` 下 `wren context build`；小内存服务器可 `WREN_MEMORY_ENABLED=false` 跳过本地 embedding（由 `EMBEDDING_*` 远程向量检索接管）；`HF_ENDPOINT=https://hf-mirror.com` 仅在启用 memory 时需要

## 知识图谱（Apache AGE）

- 生产库为 `infra/age-postgres.Dockerfile` 构建的 PG18 + AGE 1.7.0 镜像（`shared_preload_libraries=age`）
- 装载：容器首启跑 `infra/postgres/zz_graph_init.sql`；AGE 1.7+ 需 bind 协议传参时用 `infra/load_graph_age17.py`（`docker exec` + psql `\bind`）
- 业务表 → 图：机构树/员工归属/客户-保单（投保/被保/受益）/保单-产品-理赔-保全/核保与审核人，手动重建见 `zz_graph_init.sql` 头注释
- 前端 `/graph`：力导向图，单击节点看属性详情卡、双击/卡片按钮下钻一跳，图例芯片可过滤节点类型与关系类型

## 从数据库导入（自定义 Agent 快捷方式）

管理页"从数据库导入"：给定数据库连接 + schema（+ 可选中文描述），后端内省 `information_schema` + `pg_catalog` 自动生成 WrenAI 工程 JSON，回填表单校验后注册。

- 内省逻辑：`backend/app/semantic/db_introspect.py`（`introspect_database` / `build_mdl` / `parse_description_map`）
- 端点：`POST /api/admin/agents/import-from-db`（纯生成、不落库）

## 构建、测试与开发命令

后端（Python，在 `backend/` 目录）：

- `pip install -e backend[dev]`（或 `pip install -e '.[dev]'` 在 `backend/` 内）— 安装依赖（国内源 `-i https://pypi.tuna.tsinghua.edu.cn/simple`）
- `uvicorn app.main:app --port 8080 --reload`（在 `backend/` 内）— 启动 API（:8080）
- `pytest backend/tests`（或 `pytest` 在 `backend/` 内）— 运行测试
- 配置：仓库根 `.env`（参考 `.env.example`），pydantic-settings 自动加载；`OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_MODEL` 必配；`ADMIN_TOKEN` + `AGENT_SECRET_KEY`（配置后启用自定义 Agent）；`AUTH_ENABLED=true`（生产必须）；`INTERNAL_API_TOKEN`（Pi 编排层 internal API 鉴权，前后端共享）

编排层（Node，在 `services/pi-orchestrator/` 内）：

- `npm install` / `npm ci` — 安装依赖（有 lockfile；Node ≥22.19）
- `npm test` — Vitest（51 用例）
- `npm start` — 启动编排层（:8090，读仓库根 `.env`；`PI_BIND_HOST` 默认 0.0.0.0，`PI_SESSION_BACKEND=pg` 会话落 Postgres）

前端（TypeScript，在 `frontend/` 内）：

- `pnpm install` — 安装依赖（CI 用 `--frozen-lockfile`；pnpm 11 构建白名单见 `frontend/pnpm-workspace.yaml` 的 `allowBuilds`）
- `pnpm dev` 或 `pnpm dev:web` — 启动 Web（:3000）。**`pnpm dev` 只起前端，后端需单独 `uvicorn` 起**。不要在 dev 运行时执行 `pnpm build`（`.next` 缓存冲突）
- `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` — 构建/Lint/类型检查/测试

基础设施与生产部署：

- `docker compose up -d` — 本地启动 PostgreSQL/Redis（见 `docker-compose.yml`）
- 生产：`docker compose -f docker-compose.prod.yml up -d`（postgres 用 AGE 镜像，backend 18080 映射）。**小内存服务器（≤2G）不要在服务器上构建镜像**——本地 `docker build` → `docker save | gzip` → 上传 → 服务器 `docker load` → `up -d`，镜像命名须与 compose 项目匹配（如 `pi-wren-prod-web:latest`）

## 编码风格与命名约定

后端（Python）：4 空格缩进；模块 snake_case（`db_introspect.py`），函数/变量 snake_case，类 PascalCase；类型注解（`from __future__ import annotations`）；FastAPI 路由 + asyncpg 异步；pydantic-settings 校验环境配置。

编排层（Node，仅 `services/pi-orchestrator`）：ESM `.mjs`，2 空格缩进，无分号风格跟随现有文件；配置集中 `src/config.mjs`，事件构造统一走 `src/events.mjs`。

前端（TypeScript，仅 `frontend/apps/web`）：2 空格缩进，分号，单引号（Prettier 强制）；strict 模式、`verbatimModuleSyntax`、`noUncheckedIndexedAccess`；文件名 kebab-case，函数/变量 camelCase。

## 测试指南

后端：pytest + pytest-asyncio（`asyncio_mode = "auto"`），测试在 `backend/tests/`，命名 `test_*.py`；纯函数测试（SQL 校验/结果分析/内省/加密/限流/指标/embedding 检索）+ 认证与用户管理（`test_auth_*`、`test_admin_users.py`、`test_passwords.py`）+ 机构行级权限（`test_org_scope.py` SQL AST、`test_traditional_org.py`）+ Pi 代理与内部路由（`test_assistant_proxy.py` 熔断/降级、`test_internal_agent.py`、`test_internal_graph`）+ 会话归属（`test_session_ownership.py`）+ `test_golden_sql.py`（真实 MDL dry_plan 回归，wrenai 升级防护；本地需先 `wren context build`）。内省/图谱 payload 组装逻辑用纯函数测（喂固定 rows），DB 查询部分不测（项目无 DB fixture）。

编排层：`npm test`（Vitest，51 用例）：护栏（guardrails）、事件协议（events/protocol ajv 校验）、会话存储（sessions/sessions_pg，pg 用注入假池）、三个工具的参数/断言、agent-service（假 model + 假工具的循环行为）与 server（supertest 式 HTTP/SSE）。全部纯单元，无需真实 LLM/DB。

效果评测（非 pytest，需真实 DB/LLM/MDL，在 `backend/` 内执行）：`python -m evals.run_eval [--only <fnmatch>] [--judge]` 跑 NL→SQL 评测回归集（`backend/evals/cases/insurance.json`，30 条中文案例），报告落 `backend/evals/reports/`（已 gitignore）；判定逻辑纯函数测试见 `tests/test_eval_checks.py`。

前端：Vitest（`frontend/apps/web` 的 `*.test.ts`）。

CI（`.github/workflows/ci.yml`）三个 job：frontend（lint/typecheck/test/build）、backend（pytest + 可选 golden_sql）、pi-orchestrator（npm ci + npm test）。

## 提交与 PR 指南

- Conventional Commits，小写祈使句：`feat: add db introspection import`、`fix: drop ts backend, unify on python`
- 每次提交一个逻辑变更；PR 面向 `main`，关联 issue、说明"改了什么/为什么"、列出手工验证步骤，UI 变更附截图

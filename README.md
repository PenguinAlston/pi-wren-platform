# pi-wren-platform

基于 **WrenAI**（企业语义上下文层）与 **LangChain/LangGraph** 编排的企业级自然语言数据分析平台。用户用自然语言向企业数据提问，平台自动完成：业务理解 → 语义层生成 SQL（安全校验）→ 数据查询 → 结果分析 → 执行摘要。

后端为 Python（FastAPI），前端为 Next.js（TypeScript）。

## 核心能力

- **自然语言查数**：中文提问 → WrenAI 语义检索 + LLM 动态生成 SQL → WrenAI 受治理校验 + 只读安全校验 → PostgreSQL 查询 → 防幻觉业务摘要
- **多 Agent 开箱即用**：保险综合查询（22 张生产级业务表 + 字典中文标签）
- **自定义 Agent（自助注册）**：用户提供一份 WrenAI 工程 JSON + 数据库连接串，即可注册专属查询 Agent，无需改代码/重启；**支持「从数据库导入」**——给连接即可内省表结构自动生成工程 JSON
- **多轮会话**：jsonl 会话仓库持久化（重启不丢），续聊自动注入历史
- **SSE 流式输出**：执行事件实时推送，前端实时渲染轨迹
- **企业治理**：管理操作审计落库（sys_operation_log）、连接串 AES-256-GCM 加密、多租户 owner_id、连接池监控、SQL 表名白名单注册即隔离

## 快速开始

前置要求：Python ≥ 3.12、Node.js ≥ 22.19、pnpm ≥ 10、Docker。

```bash
# 1. 启动本地基础设施（PostgreSQL + Redis）
docker compose up -d

# 2. 安装并启动后端（Python FastAPI，:8080）
cd backend
pip install -e '.[dev]' -i https://pypi.tuna.tsinghua.edu.cn/simple
uvicorn app.main:app --port 8080 --reload

# 3. 安装并启动前端（Next.js，:3000，另开终端）
cd ..
cd frontend
pnpm install
pnpm dev
```

打开 <http://localhost:3000/chat> 提问（如"为什么利润下降？"）；自定义 Agent 管理入口在 <http://localhost:3000/agents>（需 `.env` 中的 `ADMIN_TOKEN`）。

语义层完全基于 WrenAI 原生工程（`semantic/wren/`），需配置真实 LLM provider 与 WrenAI（见 `.env.example`）。

## 架构

```
用户
 │
Web (:3000) ──/api 代理──►  FastAPI 后端 (:8080，backend/)
 │   /chat 聊天控制台            ├─ GET /api/agents
 │   /agents 自定义 Agent 管理   ├─ POST /api/agent/{domain}/chat（JSON / SSE 流式）
 │                              └─ /api/admin/agents*（X-Admin-Token）
 │
后端 app/
 ├─ routers/        路由层（agents/chat/sessions/admin_agents/traditional/health）
 ├─ semantic/       语义层（WrenEngine 进程内 + mdl_loader 白名单 + sql_validation + db_introspect 从库内省）
 ├─ registry/       自定义 Agent 注册表（sys_agent_config + AES 加密 + 审计 + 生命周期）
 ├─ data/db.py      asyncpg 连接池（只读事务 + 语句超时 + 行数上限）
 └─ session/        jsonl 多轮会话持久化
 │
数据 → PostgreSQL（内置表 + 自定义 Agent 独立连接池）
```

## 环境变量

复制 `.env.example` 并按需配置（后端用 pydantic-settings 自动加载）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 后端端口 |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `piwren` / `demo` / `demo` | PostgreSQL 连接 |
| `LLM_PROVIDER` | `openai` | `openai` \| `anthropic` \| `ollama`（必配真实 provider） |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | - | OpenAI 兼容接口（含阿里云 DashScope 等） |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | - | Anthropic |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `qwen2.5:7b` | 本地 Ollama |
| `WREN_PROJECT_DIR` | `semantic/wren` | WrenAI 工程目录（`wren_project.yml` 所在） |
| `SESSION_DIR` | `data/sessions` | 会话 jsonl 持久化目录 |
| `ADMIN_TOKEN` | - | 自定义 Agent 管理面鉴权（`X-Admin-Token`） |
| `AGENT_SECRET_KEY` | - | 连接串加密密钥（≥8 字符，建议 ≥32 字节；**配置后才启用自定义 Agent**） |
| `AUDIT_USER_ID` | `UADMIN` | 管理操作审计主体（sys_user.user_id） |

## 常用命令

后端（在 `backend/`）：

```bash
uvicorn app.main:app --port 8080 --reload   # 启动后端
pytest                                       # 测试
```

前端（仓库根）：

```bash
cd frontend && pnpm dev  # 启动 Web（:3000，仅前端；后端需单独 uvicorn 起）
pnpm build        # 构建（frontend/ 内）
pnpm lint         # ESLint（frontend/ 内）
pnpm typecheck    # 类型检查（frontend/ 内）
```

## 项目结构

```
backend/             Python 后端（FastAPI + WrenAI 进程内 SDK + LangChain/LangGraph）
  app/
    routers/         路由（agents/chat/sessions/admin_agents/traditional/health）
    semantic/        语义层（WrenEngine / mdl_loader / sql_validation / db_introspect / result_analysis）
    registry/        自定义 Agent 注册表（store/crypto/audit/agent_registry）
    data/            asyncpg 数据层
    session/         jsonl 会话
    agents/          领域配置（内置 Agent）
  tests/             pytest 测试
apps/
  web/               Next.js 聊天控制台（app/chat）+ 自定义 Agent 管理页（app/agents）
packages/
  shared-types/      前端共享类型
semantic/wren/       WrenAI 原生语义工程（models + relationships + knowledge，单一语义源）
examples/            wren-project-template.json（自定义 Agent 工程 JSON 模板）
infra/postgres/      建表与种子数据（insurance_schema/insurance_seed/agent_config/z_admin_seed）
docs/                架构、进展、路线图与设计文档
```

## API 端点

- `GET /api/agents` — Agent 列表（内置 + 自定义，含 source）
- `POST /api/agent/chat`、`POST /api/agent/{domain}/chat` — 问答（支持 `sessionId` 续聊）
- `POST /api/agent/{domain}/chat/stream` — SSE 流式版（执行事件实时推送）
- 自定义 Agent 管理面（`X-Admin-Token`；网页入口 `/agents`）：
  - `POST /api/admin/agents` — 注册（WrenAI 工程 JSON + 连接串，AES 加密落库，支持 `ownerId`）
  - `GET /api/admin/agents`（`?ownerId=` 过滤）、`GET /api/admin/agents/{id}` — 查询（连接脱敏）
  - `PUT /api/admin/agents/{id}`（含启停）、`DELETE /api/admin/agents/{id}` — 更新/注销
  - `POST /api/admin/agents/validate-project` — 仅校验 WrenAI 工程 JSON
  - `POST /api/admin/agents/import-from-db` — 从数据库内省自动生成工程 JSON（不落库）
  - `GET /api/admin/agents/{id}/status` — 运行状态监控
  - 管理操作自动写 `sys_operation_log` 审计；模板见 `examples/wren-project-template.json`
- `GET /health` — 健康检查

## 测试

后端 pytest 用例覆盖：SQL 校验（含对抗性用例）、结果分析、数据库内省生成 MDL（含复合外键/删列/多 FK 去重）、AES 加密、jsonl 会话持久化。

## 文档导航

- [docs/technical-architecture.md](docs/technical-architecture.md) — 技术架构（结果版，分层图/模块表/数据流）
- [docs/architecture.md](docs/architecture.md) — 架构演进说明
- [docs/enterprise-roadmap.md](docs/enterprise-roadmap.md) — 企业级路线图与待办
- [docs/mvp-progress.md](docs/mvp-progress.md) — MVP 进展
- [docs/custom-agent-design.md](docs/custom-agent-design.md) — 自定义 Agent 功能设计
- [docs/pi-integration-assessment.md](docs/pi-integration-assessment.md) — 开源 Pi 接入评估

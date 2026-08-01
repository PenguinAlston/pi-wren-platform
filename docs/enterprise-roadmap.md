# 企业级演进路线图

本文记录从 MVP 骨架到企业级平台已完成的工程化改造，以及后续需要处理的能力清单。

## 已完成（2026-08）

### 工程基础
- [x] pnpm workspace 重构（`pnpm-workspace.yaml`，8 个 workspace）
- [x] 统一的 TypeScript 基础配置（strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`）
- [x] ESLint 9 flat config + Prettier
- [x] 环境配置集中校验（zod）+ `.env.example`
- [x] 依赖锁定（`pnpm-lock.yaml`），CI 使用 `--frozen-lockfile`
- [x] GitHub Actions CI（lint / typecheck / test / build）

### 运行时能力
- [x] 真实 LLM Provider：OpenAI 兼容、Anthropic、Ollama + 离线 Mock
- [x] Wren AI HTTP 客户端（语义层 SQL 生成）+ demo 语义层（无外部依赖可跑）
- [x] PostgreSQL 数据引擎（连接池、SQL 执行、错误包裹）
- [x] FinanceAgent 全链路：计划 → SQL → 查询 → 分析 → 摘要（依赖注入，可测试）
- [x] 结构化执行事件（plan/tool_call/tool_result/observation/answer/error）与轨迹
- [x] 内存会话记忆抽象（`MemoryStore` 接口）
- [x] Express API：健康检查、请求校验、pino 结构化日志、统一错误处理、优雅停机
- [x] Next.js 聊天控制台（结论、轨迹、SQL、结果表）
- [x] Vitest 单元/集成测试（20+ 用例）

## 待处理（建议顺序）

### P1 — 上线前必做
- [ ] 身份认证与授权（API key / JWT / RBAC），目前 chat 路由完全开放
- [ ] 会话记忆持久化（Redis/Postgres），当前为进程内内存
- [ ] SQL 安全（只读事务、超时、行数上限、禁止危险语句），目前直接执行生成 SQL
- [ ] LLM 流式输出（SSE），当前为一次性 JSON 响应
- [ ] API 与 Web 的 Dockerfile + compose 编排（当前只有依赖服务）
- [ ] 错误追踪（Sentry 或 OpenTelemetry 导出）

### P2 — 可观测性与可靠性
- [ ] 指标端点（`/metrics`，Prometheus）：请求数、延迟、工具成功率
- [ ] 分布式追踪（OpenTelemetry + Jaeger）
- [ ] 限流与熔断（Rate limit per key）
- [ ] 数据库迁移工具（当前依赖容器初始化脚本）
- [ ] 缓存层（Redis 缓存指标定义与 SQL 生成结果）

### P3 — 平台化
- [ ] 通用 Agent 运行时（当前只有 FinanceAgent 一条流水线）
- [ ] 工作流引擎（多步编排、审批流）
- [ ] 审计日志（谁在什么时间问了什么问题、执行了什么 SQL）
- [ ] 指标定义管理界面（Wren 语义模型 CRUD）
- [ ] 多数据源连接器（BigQuery、Snowflake 等）
- [ ] 多租户与细粒度数据权限（行级/列级）

## 架构决策记录

- **mock LLM = 离线模式**：`LLM_PROVIDER=mock` 时不注入 LLM，由确定性分析器产出回答，保证 demo 零外部依赖；配置真实 Provider 后自动启用 LLM 摘要。
- **`services/api` 已合并至 `apps/api`**：消除重复的 API 入口，统一为唯一 API 服务。
- **packages 以源码形式被 workspace 消费**（`main` 指向 `src/index.ts`），dev 用 tsx、生产构建由 API 的 tsup 打包、Web 由 Next transpilePackages 处理。

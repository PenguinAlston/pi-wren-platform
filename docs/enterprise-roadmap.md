# 企业级演进路线图

本文记录从 MVP 骨架到企业级平台已完成的工程化改造，以及后续需要处理的能力清单。

## 已完成（2026-08）

### 工程基础
- [x] pnpm workspace 重构（`pnpm-workspace.yaml` + `allowBuilds`，8 个 workspace）
- [x] 统一的 TypeScript 基础配置（strict + `verbatimModuleSyntax` + `noUncheckedIndexedAccess`）
- [x] ESLint 9 flat config + Prettier
- [x] 环境配置：zod 校验 + `.env` 自动加载（dotenv）+ `.env.example`
- [x] 依赖锁定（`pnpm-lock.yaml`），CI 使用 `--frozen-lockfile`
- [x] GitHub Actions CI（lint / typecheck / test / build）

### 运行时能力
- [x] 真实 LLM Provider：OpenAI 兼容（已接入阿里云 DashScope qwen3.7-flash）、Anthropic、Ollama + 离线 Mock
- [x] LLM 动态 SQL 生成（`LlmContextEngine`）：提示词注入表结构/业务知识/示例意图
- [x] SQL 安全校验（`sql-validation`）：仅 SELECT/WITH、拦截高危语句、单语句、表名白名单
- [x] 失败自动降级：LLM 不可用/输出不安全 → 规则引擎兜底，查询永不中断
- [x] 防幻觉提示词：日期/数值逐字照抄，查不到的字段如实说明"未包含"
- [x] MDL 式语义引擎（`semantic/*.mdl.yml`：模型/意图/指标/知识，关键词评分匹配）
- [x] Wren AI HTTP 客户端（配置 `WREN_URL` 启用真实服务）
- [x] PostgreSQL 数据引擎（连接池、SQL 执行、错误包裹）
- [x] DataAnalysisAgent 通用流水线：计划 → SQL → 查询 → 分析 → 摘要（领域配置驱动，财务/保险双 Agent）
- [x] 结构化执行事件（plan/tool_call/tool_result/observation/answer/error）与前端轨迹
- [x] 内存会话记忆抽象（`MemoryStore` 接口）
- [x] 保险核心业务表结构（依据需求文档：契约/保全/理赔/客户/字典等 22 张生产级表 + 种子数据）
- [x] Express API：健康检查、请求校验、pino 结构化日志、统一错误处理、优雅停机、超时保护
- [x] Next.js 聊天控制台：多 Agent 切换、结论、轨迹、SQL、结果表、120s 请求超时
- [x] Next 代理超时修复（`proxyTimeout: 120s`，适配慢速 LLM）
- [x] Vitest 单元/集成测试（46 个用例）

## 待处理（建议顺序）

### P1 — 上线前必做
- [ ] 身份认证与授权（API key / JWT / RBAC），目前 chat 路由完全开放
- [ ] SQL 执行硬约束（数据库层只读事务、行数上限、超时）——生成层已有校验，执行层待加固
- [ ] 会话记忆持久化（Redis/Postgres），当前为进程内内存
- [ ] 审计日志落库（`sys_operation_log` 表已建，未接入业务）
- [ ] LLM 流式输出（SSE），当前为一次性 JSON 响应
- [ ] API 与 Web 的 Dockerfile + compose 编排（当前只有依赖服务）
- [ ] 错误追踪（Sentry 或 OpenTelemetry 导出）

### P2 — 可观测性与性能
- [ ] 指标端点（`/metrics`，Prometheus）：请求数、延迟、工具成功率
- [ ] 分布式追踪（OpenTelemetry + Jaeger）
- [ ] 限流与熔断（Rate limit per key）
- [ ] 混合路由提速：常见问题走规则快路径（<1s），仅新问题走 LLM（当前单问 20–50s）
- [ ] 数据库迁移工具（当前依赖容器初始化脚本）
- [ ] 缓存层（Redis 缓存指标定义与 SQL 生成结果）

### P3 — 平台化
- [ ] 工作流引擎（多步编排、审批流）与 Agent 注册/发现中心（当前为配置文件注册）
- [ ] 指标定义管理界面（语义模型 CRUD）
- [ ] 多数据源连接器（BigQuery、Snowflake 等）
- [ ] 多租户与细粒度数据权限（行级/列级）
- [ ] 开源 Pi 会话层接入（SSE 流式 + 会话持久化，Spike 已通过，见 `docs/pi-integration-assessment.md`）

## 架构决策记录

- **mock LLM = 离线模式**：`LLM_PROVIDER=mock` 时不注入 LLM，由确定性分析器产出回答，保证 demo 零外部依赖；配置真实 Provider 后自动启用 LLM 动态 SQL 生成 + 摘要。
- **LLM 生成 SQL 的安全边界**：生成层强制只读/防注入/表名白名单，失败自动降级规则引擎；数据库执行层加固列入 P1。
- **`services/api` 已合并至 `apps/api`**：消除重复的 API 入口，统一为唯一 API 服务。
- **packages 以源码形式被 workspace 消费**（`main` 指向 `src/index.ts`），dev 用 tsx、生产构建由 API 的 tsup 打包、Web 由 Next transpilePackages 处理。
- **`.env` 位于仓库根**：API 通过 dotenv 自动加载（cwd 或仓库根），已被 gitignore，密钥不进入 Git。
- **开源 Pi 仅作会话层接入（不替换流水线）**：`pi-agent-core` 嵌入 Spike 已跑通（DashScope 兼容 provider + 自定义工具 + 多轮会话），但 LLM 自由循环不可控，现有确定性 SQL 流水线保持不变；Pi 只用于会话持久化/事件流，详见 `docs/pi-integration-assessment.md`。

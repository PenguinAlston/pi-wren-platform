# 企业级演进路线图

本文记录平台企业级改造的完成情况与待处理清单（2026-09-13 对照代码现状全面更新）。

## 已完成

### 工程基础
- [x] 混合技术栈单仓：Python 后端（FastAPI）+ Node 编排层（pi-orchestrator）+ Next.js 前端（pnpm workspace）
- [x] 后端 pydantic-settings 配置校验 + 仓库根 `.env`（不入库）；编排层 `src/config.mjs` 集中配置
- [x] CI 三 job（`.github/workflows/ci.yml`）：frontend（lint/typecheck/test/build）、backend（pytest + golden SQL 可选回归）、pi-orchestrator（npm ci + 51 用例）
- [x] 编排层 lockfile（`package-lock.json`）保证 CI 可复现安装

### 可观测性与运行时加固（2026-09 P2）
- [x] Prometheus 指标双端点（后端 + 编排层，零依赖渲染器）+ 采集 profile，详见 `docs/observability.md`
- [x] Sentry 可选错误追踪（双服务，DSN 驱动）
- [x] Redis 限流共享态（ZSET 滑动窗口 + 异步统一门面，降级内存）

### 治理与安全
- [x] 认证与用户管理：登录会话 + internal token、用户管理页、会话归属隔离、口令强度策略
- [x] 机构行级权限 OrgAccess 三态（admin/org/deny）：问数 SQL AST 强制（sqlglot 三级降级）、传统查询机构覆盖 + deny 403、图谱 BFS 子图过滤；Pi 工具回调链路（internal API + x-user-id 反查）同样受控
- [x] SQL 治理：WrenAI dry-run 校验 + 表名白名单二次校验 + 危险语句拦截，只读事务/语句超时/行数上限
- [x] 审计：管理操作与问数记录落库；点赞/点踩反馈落库 + 管理端查看
- [x] 限流（后端 ratelimit）+ Pi 侧护栏（工具次数/总时长/工具超时/SSE 上限）

### 运行时能力
- [x] WrenAI 原生语义工程（MDL v5 单一源）+ 进程内引擎 + 语义检索三级降级（远程 embedding / 本地 memory / MDL 直读）
- [x] Pi 多工具编排（M1/M2）：三工具经 internal API 回调 Python 治理边界；SSE token 级流式；事件契约 ajv 校验；会话存储 PG/JSONL 切换
- [x] 知识图谱：PG18 + AGE 1.7.0 生产镜像、关系表 → 图装载器、`/api/graph/*` + Neo4j 风格可视化
- [x] 传统查询：契约/保全/理赔多条件组合 + 详情 + CSV 导出 + 出口脱敏（身份证/手机号）
- [x] 自定义 Agent 平台：注册/加密/审计/池监控 + "从数据库导入"内省生成工程 JSON
- [x] 效果评测：30 条中文 NL→SQL 回归集 + golden SQL dry_plan 回归

### 部署
- [x] 生产五容器编排（`docker-compose.prod.yml`）：postgres（AGE）/ redis / backend / web / pi-orchestrator，健康检查 + mem_limit
- [x] 小内存（1.6G）部署验证：镜像瘦身（多阶段 + CPU-only + 跳过 LLVM）、`WREN_MEMORY_ENABLED=false`、镜像 save/load 流水线（服务器零构建）
- [x] 生产已上线并经外网验证（登录、问数、传统查询、图谱、流式）

## 待处理（建议顺序）

### P1 — 上线加固
- [ ] 服务器凭据轮换：root 密码、面板/AK 等已在聊天中明文暴露的凭据全部更换
- [ ] SSH 关闭密码认证改密钥登录；服务器交接文档
- [ ] pg_dump 定时备份（cron + 异地/对象存储），并演练一次恢复
- [ ] 服务器环境跑一轮 30 条评测回归（验证生产检索/LLM 链路质量基线）

### P2 — 可观测性与性能
- [x] Prometheus 指标：后端 `/api/metrics`（HTTP 计数/时延按粗分类路由 + chat/限流/反馈计数）+ 编排层 `/metrics`（工具成功率/时延/护栏拒绝/回答时长），采集配置见 `infra/prometheus.yml` 与 compose `monitoring` profile（见 `docs/observability.md`）
- [x] 错误追踪：Sentry 可选接入（后端 sentry-sdk[fastapi] + 编排层 @sentry/node，配置 `SENTRY_DSN` 即启用，未配置零开销）
- [x] Redis 落地（第一步）：限流共享态切 Redis ZSET（`REDIS_URL` 配置即启用，失败自动降级内存，多副本一致）；限流/缓存进一步用途待做
- [ ] 混合路由提速：常见问题快路径（<1s），仅新问题走 Agent 循环（建议先跑服务器端 30 条评测基线，用数据定位常见问题再设计快路径）
- [ ] 数据库迁移工具（当前依赖 init 脚本 + 手工 SQL）

### P3 — 平台化
- [ ] M4 文档问答：doc_search RAG 工具接入 Pi 编排（文档向量化 + internal 检索端点）
- [ ] Pi 多副本 + 负载均衡（会话已 PG 共享，缺前置 LB 与副本编排）
- [ ] Pi 会话重命名/归档（当前仅新建/删除/搜索）
- [ ] 列级数据权限与敏感字段分级（当前行级已完成）
- [ ] 多数据源连接器（自定义 Agent 已支持任意 PG 连接串；BigQuery/Snowflake 等待做）

## 架构决策记录

- **Pi 编排层独立 Node sidecar（方案 A）**：Agent 循环在 Node（pi-agent-core 0.83.0），治理边界全部留在 Python 后端——工具只能经 internal API 回调，模型接触不到裸 SQL/裸连接串。锁死 0.83.0，升级需跑编排层 51 用例 + E2E。
- **语义层唯一源是 WrenAI 原生工程**：检索/校验/白名单均从 `semantic/wren/target/mdl.json` 派生；远程 embedding 只是检索加速，降级链最终兜底 MDL 直读。
- **机构权限在 SQL AST 层强制而非提示词层**：org 模式下 sqlglot 改写/校验 + 传统查询/图谱各自覆盖，提示词只是辅助。
- **生产部署禁服务器构建**：1.6G 内存 ECS 上构建会 IO 卡死；统一本地构建 → save/gzip → 上传 → load → `up -d`。
- **`.env` 位于仓库根**：后端/编排层共用，已 gitignore，密钥不进 Git。

# MVP 进展

> 状态：2026-09-13 更新。平台已完成从单一问数 MVP 到 **Pi 多工具编排 + 机构行级权限 + 知识图谱 + 生产部署** 的演进，生产环境（1.6G 内存 ECS）五容器稳定运行并经外网验证。企业级演进清单见 [enterprise-roadmap.md](enterprise-roadmap.md)，架构图见 `docs/architecture-overview.png` 与 `docs/technical-architecture.png`。

> 早期（2026-08）TypeScript/Express 单体阶段的里程碑记录已随架构迁移完成使命，详见 Git 历史（`fix: drop ts backend, unify on python` 前后）。

## 已完成（按里程碑）

### 语义层与问数流水线（底座）
- [x] WrenAI 原生语义工程（`semantic/wren/`，MDL schema v5）作为唯一语义源；Python 后端进程内引擎 + dry-run 校验 + 表名白名单二次校验
- [x] 语义检索三级降级：远程 embedding（OpenAI 兼容 `/embeddings`，小内存部署默认）→ 本地 WrenMemory → MDL 直读；`WREN_MEMORY_ENABLED` 可关
- [x] LLM 防幻觉摘要、多轮历史注入、token 级 SSE 流式（`answer_delta`）
- [x] NL→SQL 评测回归集（30 条中文保险案例）+ golden SQL dry_plan 回归（wrenai 升级防护）

### Pi 多工具编排（M1-M2，`services/pi-orchestrator`）
- [x] Node sidecar：Pi Agent 循环 + 三个受控工具（ask_data / traditional_query / graph_query），工具经 internal API 带用户身份回调 Python 后端
- [x] 护栏：单轮工具 ≤8 次、175s 总时长、120s 工具超时、180s SSE 上限，失败/超时差异化兜底文案
- [x] SSE 事件协议（plan/tool_call/tool_result/observation/answer_delta/done）+ `protocol/events.schema.json` ajv 契约校验
- [x] 会话存储 PG（`pi_session_turn`，多副本共享）/ JSONL 可切换；后端代理熔断 + 健康探测自动恢复

### 机构行级权限与认证
- [x] 登录鉴权（会话 + token）、用户管理页、会话归属隔离
- [x] OrgAccess 三态（admin/org/deny）：问数 SQL AST 级强制（sqlglot）、传统查询机构覆盖、图谱 BFS 子图过滤，internal 链路同样生效

### 知识图谱（Apache AGE）
- [x] PG18 + AGE 1.7.0 生产镜像；业务关系表 → 图谱装载（bind 协议装载器，46 节点/81 关系）
- [x] `/api/graph/overview|neighbors|stats` + 前端 `/graph` Neo4j Browser 风格力导向可视化（详情卡/下钻/图例过滤/缩放）

### 前端体验（M3 + 视觉打磨）
- [x] 对话式首页（Pi 优先，功能面板按角色），经典问数降级为 `/chat`
- [x] Material 3 设计系统（#19b49d 主题、自研 UI 组件库）、移动端适配、消息动作图标化、点赞/点踩反馈与后台查看

### 部署与工程化
- [x] 生产五容器编排（postgres-AGE / redis / backend / web / pi-orchestrator），小内存镜像瘦身（9.66G → 1.29G，运行 ~134MB）
- [x] 部署流水线：本地构建 → save/gzip → 上传 → load → `up -d`（服务器禁止构建，防 IO 卡死）
- [x] CI 三 job：frontend / backend（含 golden SQL）/ pi-orchestrator（51 用例）

## 当前架构（一图流）

```
浏览器 ─ Next.js :3000 ─ FastAPI :18080 ── Pi sidecar :8090（Agent 循环 + 工具护栏）
              │                │  └─ WrenAI 语义层（检索/校验）+ LLM + org_scope
              │                └─ internal API（工具回调：问数/清单/图谱）
              └──────── PostgreSQL（AGE 图谱 + 业务表 + Pi 会话）+ DashScope（LLM/embedding）
```

## 遗留项（详见路线图）

- 上线加固：服务器 root 密码/凭据轮换（已在聊天中暴露）、关闭 SSH 密码认证改密钥、pg_dump 定时备份
- 混合路由提速（先跑服务器端评测基线）、数据库迁移工具
- M4：文档问答（doc_search RAG 工具）、Pi 多副本 + 负载均衡
- Pi 会话重命名；Redis 进一步用途（限流已接，缓存待做）
- 服务器环境跑一轮 30 条评测回归（当前仅在本地验证过）

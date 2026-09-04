# Pi 编排底座设计（pi-orchestrator）

> 日期：2026-09-05 · 状态：设计已评审通过，待实施
> 前置文档：`docs/pi-integration-assessment.md`（2026-08 接入评估，方案 A 会话层已随 TS 后端废弃）

## 1. 背景与目标

当前 AI 问答由 Python 后端的确定性流水线完成（WrenAI 语义检索 → LLM 生成 SQL → 治理校验 → 执行 → 防幻觉摘要），链路可控但只服务于"问数"单一场景。

本设计引入开源 Pi（`earendil-works/pi`，pi-ai + pi-agent-core）作为**多工具编排底座**：

- Pi 是对话大脑：理解意图、维护多轮上下文、决定调用哪个工具、转述与二次加工工具结果
- 问数是第一个工具：数据类问题路由给现有 WrenAI 治理流水线，**流水线一行不改**
- 后续工具按同一协议挂载：图谱查询（M2）、传统查询（M2）、文档问答（M4）
- 交互形态最终演进为**对话为主的首页**（M3），传统查询等功能面板围绕对话展开

### 明确不做的事

- 不用 Pi 替换确定性问数流水线（评估文档的风险结论继续有效）
- Pi 层不连数据库、不实现业务逻辑、不对外暴露端口
- SQL 校验、机构行级权限、防幻觉边界全部保留在 Python 侧

## 2. 方案决策记录

在"Pi 跑在哪"上有三个候选：

| 方案 | 说明 | 结论 |
|---|---|---|
| **A. 独立 Node sidecar** | `services/pi-orchestrator`（Node ≥22.19）独立进程，Python 代理转发 | **采纳**：唯一真正落地 pi 框架的方案，编排层独立演进 |
| B. Python + LangGraph 自研 | 同构架构但不引入 Node | 否：与"使用 Pi"的目标相悖，仅作对照 |
| C. Python 内嵌 Node 子进程 | stdio JSON 通信 | 否：进程管理/崩溃恢复复杂，收益低 |

版本策略：pi 锁定 **0.83.0**（2026-08 spike 验证版本；0.x API 不稳定，升级须专项回归）。LLM 复用 `.env` 的 `OPENAI_BASE_URL`/`OPENAI_API_KEY`（DashScope 兼容端点）。

## 3. 架构总览

```
浏览器 (Next.js, :3000)
   │  SSE / REST（现有代理机制不变，浏览器只感知 :3000）
   ▼
Python FastAPI (:8080) ── 复用现有 Auth 中间件 / 限流 / 审计
   │  新增 /api/assistant/*：纯代理层（SSE 转发 + 身份注入 + 熔断降级）
   ▼
Pi Orchestrator（Node ≥22.19, :8090, services/pi-orchestrator）
   │  pi-agent-core Agent 循环 + 系统提示词 + 会话持久化（pi session repo）
   │  工具 = 对 Python 内部接口的受控 HTTP 调用（internal token）
   ▼
Python 内部接口 (:8080, /internal/*)
   ├─ ask_data           → 现有 DataAnalysisAgent（WrenAI 流水线，不改）
   ├─ (M2) graph_query / traditional_query
   └─ (M4) doc_search
   ▼
PostgreSQL / Wren / Apache AGE
```

原则：**Python 是能力中心，Pi 是话事的大脑**。Pi 离开能力中心无法产生任何业务回答。

## 4. 组件设计

### 4.1 services/pi-orchestrator（Node）

- `AgentService`：每轮请求实例化 Agent（sessionId 贯通多轮），订阅 pi 事件流
- `tools/ask_data.ts`：typebox 参数 schema（`{ question: string }`），HTTP 调 Python 内部接口；后续工具同构
- `events.ts`：pi 事件 → 统一 UI 事件协议（纯函数，见 4.4）
- `guardrails.ts`：轮数/次数/时长护栏（见 §5）
- `server.ts`：HTTP 服务，仅监听内网；接口：`GET /health`、`GET /sessions?user=`、`POST /sessions/:sid/messages`（SSE）、`DELETE /sessions/:sid`
- 会话存储：pi session repo，M1 用 jsonl 落卷（按 `user_id/session_id` 隔离），HA 阶段换 Postgres 实现（repo 可插拔）

### 4.2 Python 侧新增

- `app/routers/assistant.py`：`/api/assistant/*` 代理。职责：复用鉴权与限流 → 校验 internal token → 注入用户身份头 → SSE 流式透传 → 熔断与健康探测（5s 缓存）→ 审计
- `app/routers/internal.py`：`POST /internal/agent/{domain}/chat`。与现有 chat 同逻辑但跳过用户会话鉴权，凭 internal token + 身份头构造 `OrgAccess`；internal token 走配置（`INTERNAL_API_TOKEN`）
- `Settings` 新增：`PI_ORCHESTRATOR_URL`（缺省空 → `/api/assistant` 返回 503 优雅降级，现有 `/chat` 不受影响）、`INTERNAL_API_TOKEN`

### 4.3 系统提示词要点

- 角色为企业数据助手；数据类问题**必须**调用工具，禁止自行编造数值；非数据问题直接回答不调工具
- 工具描述瘦身（直接影响意图判断轮次与 P95）
- 明确各工具适用边界（M2 起多工具选择依赖此处）

### 4.4 事件协议（双端契约）

pi 事件映射为统一 UI 事件（沿用现有前端 trace 事件模型）：

| UI 事件 | 来源 | 内容 |
|---|---|---|
| `plan` | 用户消息到达 | 问题文本 |
| `tool_call` / `tool_result` | pi `tool_execution_start/end` | 工具名 + 入参/结果摘要 |
| `observation` | 工具结果附加 | 过程说明 |
| `answer_delta` | pi `message_update` 文本增量 | 流式回答 |
| `answer` | 回合结束 | 完整回答 + 结构化附件（见 §8） |
| `error` | 任意层失败 | 用户可读的错误信息 |

协议定义 JSON Schema，双端校验（契约测试防漂移）。

## 5. 工具协议与护栏

**ask_data**（首期唯一工具，domain 固定 insurance）：

- 入参：`{ question: string }`
- 出参：`{ ok, answer, sql?, rowCount, sampleRows?(≤10 行), durationMs, error? }`
- SQL 生成、白名单校验、wren dry-run、机构权限、防幻觉摘要全部在 Python 侧完成；Pi 只做转述与二次加工

| 护栏 | 值 |
|---|---|
| 单工具调用超时 | 120s |
| 单轮工具调用次数 | ≤ 8 次 |
| Agent 循环轮数 | ≤ 2 轮强制收尾 |
| 单次 SSE 总时长 | ≤ 180s，到顶注入"总结现有结果"收尾 |

## 6. 数据流与机构权限

```
用户 Cookie → Python 鉴权（AuthMiddleware）→ 代理注入 x-user-id / x-org-mode / x-org-code
  → Pi（仅透传，不解析权限）→ 工具调用携带同一组头
  → Python /internal/* 校验 internal token + 构造 OrgAccess → DataAnalysisAgent
```

- 权限判定与强制只在 Python：`deny` 用户调 ask_data 得到权限提示；`org` 用户由 sql_scope 强制 `org_code` 谓词（现有机制）
- Pi 的会话存储只含对话文本与工具结果摘要，不含业务库连接信息
- internal 接口不对公网暴露（仅容器网络/本机）

## 7. 并发 / 高可用 / P95

结论：全链路 P95 瓶颈在 LLM 调用次数，不在编排层（编排每次仅增加 1~2 次 LLM 往返）。设计原则：快失败、有界队列、可降级、逐级限并发。

### 并发模型

| 层 | 上限（初始值，压测后调） | 超出行为 |
|---|---|---|
| Pi 单副本并发 Agent 轮 | 信号量 32 | 队列深度 64，满则 429 + Retry-After |
| Python 问数流水线 | wren 引擎池扩至 ~16 + asyncpg 池扩容 | 排队，SSE 先推排队事件 |
| LLM 上游（DashScope） | 集中式客户端限流器（QPM 配额） | 429 退避重试，重试预算 ≤ 2 |

### P95 SLO（初始值）

| 指标 | 目标 P95 | 手段 |
|---|---|---|
| SSE 首字节 | ≤ 2s | 立即 ack 事件；编排 LLM 用轻量快模型 |
| 编排层开销（不含工具） | ≤ 6s | 精简提示词与工具描述 |
| ask_data 工具 | ≤ 20s | 语义检索 LRU 缓存、同问单飞（in-flight 去重）、短 TTL 结果缓存 |
| 端到端（闲聊/问数） | ≤ 4s / ≤ 25s | — |

### 稳定性机制

- 熔断：代理对 Node 健康探测（5s 缓存），连续失败打开熔断直接 503，半开恢复
- 重试：仅幂等失败（ask_data 只读，5xx 重试 1 次）；4xx 不重试
- 强制收尾：180s 总时长兜底，杜绝无限循环
- 可观测：队列深度、信号量等待、超时数、工具耗时分布进 metrics；前端 trace 展示各阶段耗时

### 高可用演进

- **阶段 1（M1）**：Pi 单副本 + 数据卷 + 容器健康检查 + 自动重启（RTO 秒级、RPO 0）+ 代理熔断降级；问数主链路 `/chat` 架构性不受影响
- **阶段 2（M4）**：session repo 换 Postgres 实现 → Pi 无状态多副本，代理按 `user_id` 一致性哈希路由
- 边界声明：PostgreSQL 目前是 docker 单机容器，为全链路真单点；99.5%+ 可用性需 PG 上 RDS/主从（基建升级，不在本期）

### 压测验收

k6（SSE 支持）：50 并发混合负载（60% 问数 / 40% 闲聊）持续 10 分钟，SLO 全达标且 0 请求悬挂。

## 8. 对话渲染与防幻觉延伸

- ask_data 回答分两路：Pi 转述**文本**走对话气泡；**表格与图表永远从事件流携带的结构化 rows / 图表 spec 渲染**，不从 LLM 文本解析。数字以结构化数据为准
- 过程渲染复用现有组件：thinking-stream（工具轨迹，标注激活工具）、markdown-body、ChatResultTable / ChatChart；Material 3 主题延续

## 9. 错误处理矩阵

| 类别 | 故障点 | 用户看到 | 恢复 |
|---|---|---|---|
| 工具级 | 流水线失败（SQL 重试耗尽 / DB 超时 / 空结果 / 120s 超时） | Pi 转述失败原因并建议改写问法（`ok:false` 交回 Pi，不中断会话） | 改问法重试 |
| 工具级 | 权限拒绝（deny / 跨机构 404） | 复用现有文案 | admin 分配机构 |
| 链路级 | 编排 LLM 429/超时、护栏触发收尾 | `error` 事件 → 错误气泡 + 重试按钮 | 重试 |
| 服务级 | Pi 不可达 / 熔断打开 | 503 + "智能助手暂不可用" + 旧 /chat 入口链接 | 半开探针自动恢复 |
| 传输级 | SSE 中断 | 断线提示；服务端 abort 传播取消 Agent 循环（省 token） | 重连后同会话续聊 |
| 数据级 | 会话 jsonl 损坏 | 单会话打开失败 | 会话隔离，可新建 |
| 输入 | 超长消息（>4000 字） | 400 提示 | — |

## 10. 测试策略

问数质量一寸不让，回归三件套必须全绿：pytest 全量、`test_golden_sql`、evals 30 条评测集（证明 Pi 包装未改变问数行为）。

- Node 侧 vitest：工具适配层（mock 后端）、事件协议转换（纯函数 + 快照）、护栏逻辑
- Python 侧 pytest：assistant 代理（鉴权、熔断、身份注入、透传）
- 协议契约测试：事件 JSON Schema 双端校验
- k6 压测脚本 = SLO 验收门槛
- 手工验收清单：多轮追问、跨工具意图、权限矩阵（admin/org/deny）、断线续聊

## 11. 分期计划

| 里程碑 | 内容 | 相对工作量 |
|---|---|---|
| M1 底座跑通 | pi-orchestrator 骨架 + ask_data + 事件协议 + 护栏 + Python 代理 + /internal 接口 + 现有 /chat 加开关灰度 + compose 集成 | ★★★★ |
| M2 工具扩展 | graph_query、traditional_query 挂载 + 工具选择调优 | ★★ |
| M3 首页改版 | 对话式首页（会话列表 + 对话流 + 功能面板，按角色显隐），`/chat` 降级为"经典问数"，`/`、`/query`、`/agents` 布局不动 | ★★★ |
| M4 后期可选 | doc_search 向量基建、session repo Postgres 化（HA 阶段 2）、多副本 | ★★★ |

## 12. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| pi 0.x API 破坏性变更 | 锁 0.83.0；升级专项回归（事件协议契约测试兜底） |
| 自由循环成本失控 | §5 护栏四件套 + abort 传播 + 180s 收尾 |
| 编排 LLM 误路由（该调工具不调） | 提示词硬约束 + 工具描述精简；M2 起观察误路由率并调优 |
| Node ≥22.19 与仓库 engines 冲突 | services/pi-orchestrator 独立声明 engines，不影响前端 workspace |
| 会话 jsonl 与 Postgres 会话列表并存 | M1 会话列表接口由代理透传 Pi；M4 统一收编 |

开放问题（不阻塞 M1）：文档问答的向量库选型；会话审计是否需要在 Pi 层重复记录（当前结论：审计只在 Python 代理层）。

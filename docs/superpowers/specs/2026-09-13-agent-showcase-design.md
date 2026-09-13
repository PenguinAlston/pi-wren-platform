# 智能体展示与显式使用（Agent Showcase）设计

> 日期：2026-09-13 · 状态：已评审通过（方案 A） · 范围：只做"注册后可见可用"，新增流程不动

## 1. 背景与问题

平台已支持两种新增智能体的方式（内置改代码；自定义走 `/agents` 管理页，含"从数据库导入"），
但注册完成后存在三个断层：

1. **对话式首页（主入口）写死了保险 Agent**：`services/pi-orchestrator/src/tools/ask_data.mjs`
   硬编码 `/internal/agent/insurance/chat`，自定义 Agent 在首页完全不可用。
2. **无展示**：首页功能面板是静态的，新 Agent 注册成功后没有任何"已就绪、去哪用"的呈现。
3. **发现成本高**：用户只能在经典问数页 `/chat` 的切换器里碰巧看到。

## 2. 目标与非目标

**目标**（用户已确认的决策）：

- 使用方式 = **显式选择**：首页智能体卡片墙（图标 + 名称 + 描述），点卡片进入该智能体对话
- 范围 = **只做展示与使用**，新增流程维持现状
- 注册/启用后**即时生效**（无需重启，最迟 ≤30s 缓存窗口）
- 会话与智能体绑定：第一条消息锁定，会话内固定，切换 = 新会话

**非目标**：

- 新增流程向导化 / 普通用户自助建 Agent + 审批流（后续单独立项）
- 按用户/机构分配智能体（卡片墙先对全部登录用户展示全部启用 Agent）
- 经典问数页 `/chat` 改造（现有切换器不动）
- traditional_query / graph_query 开放给自定义 Agent（保险业务专属，保持现状）

## 3. 架构与数据流

```
卡片墙数据：AssistantHome ──GET /api/agents（已有，含 builtin+custom）──▶ 卡片网格
提问：AssistantHome（agentDomain 随消息）
  → POST /api/assistant/chat/stream {message, sessionId?, agentDomain?}
  → 代理透传 → POST /sessions/{id}/messages {message, agentDomain?}
  → 编排层：safeId 校验 → 取会话已绑定 domain（老会话优先）→
      GET /internal/agents/{domain}（30s 缓存）→ 元数据 {domain,label,description,source}
  → toolsFactory：ask_data(domain 参数化)；domain=insurance 时追加 traditional_query + graph_query
  → 系统提示词注入 label/description → Pi Agent 循环（不变）
  → ask_data → POST /internal/agent/{domain}/chat（internal 路由本来就按 domain 路由，零改动）
```

**单一事实源**：智能体名称/描述一律以后端 `/internal/agents` 返回为准，不经前端透传
（防伪造注入提示词）。

## 4. 分层改动清单

### 4.1 后端（backend/）

- `app/routers/internal.py` 新增 **`GET /internal/agents`**（internal token 鉴权）：
  返回 `[{"domain","label","description","source"}]`，来源 `state.agents`（builtin + 已启用 custom）；
  另支持 **`GET /internal/agents/{domain}`** 单查（404 = 不存在/未启用）。
  编排层用单查端点（一次一个，缓存友好）。
- `/api/assistant/chat/stream`：body 新增可选 `agentDomain`（正则同 sessionId 白名单
  `^[A-Za-z0-9_-]{1,64}$`，非法值忽略并按缺省 `insurance`），透传给上游 `/sessions/{id}/messages`。

### 4.2 编排层（services/pi-orchestrator/）

- **`src/agent-meta.mjs`（新增）**：`createAgentMeta({backendUrl, internalToken, ttlMs=30_000, fetchImpl})`
  → `get(domain)`：内存缓存 30s；后端 404 返回 `null`（调用方报"不可用"）；网络错误抛出（上层兜底文案）。
- **`src/server.mjs`**：`/sessions/{id}/messages` body 读取 `agentDomain`（safeId，缺省 insurance）；
  会话列表 `GET /sessions` 与详情 `GET /sessions/{id}` 响应附加 `agentDomain`（取该会话最近一跳的值）。
- **`src/agent-service.mjs`**：
  - `run({..., agentDomain})`：先问 store 取会话已绑定 domain（`store.getSessionDomain`，无则用请求值）；
    元数据缺失（get 返回 null）→ push error 事件"该智能体暂不可用或未启用" + 正常收尾 done。
  - `toolsFactory({ userKey })` → `toolsFactory({ userKey, agentMeta })`：ask_data 注入 domain 与描述；
    `agentMeta.domain === 'insurance'` 时追加 traditional_query + graph_query。
  - `buildSystemPrompt(history, agentMeta)`：模板改为按元数据生成
    （你是「{label}」——{description}；工具指引按是否含业务清单工具分两种文案）。
- **`src/tools/ask_data.mjs`**：`createAskDataTool({domain = 'insurance', agentLabel, ...})`，
  URL 改 `/internal/agent/${domain}/chat`，description 追加"当前助手：{agentLabel}（{description}）"。
- **会话存储（`sessions_pg.mjs` / `sessions.mjs`）**：
  - `appendTurn` 增写 `agent_domain`（PG：`ensureSchema` 里 `ALTER TABLE pi_session_turn
    ADD COLUMN IF NOT EXISTS agent_domain varchar(64) NOT NULL DEFAULT 'insurance'`（自愈补列）；
    JSONL：turn 对象加字段即可）。
  - 新增 `getSessionDomain(userKey, sessionId)`：PG 取 `MAX(id)` 行的 agent_domain，无记录返回 null；
    JSONL 同理取最近一跳。
  - `list`/`get` 响应带 `agentDomain`（list 取每会话最近一跳的值）。

### 4.3 前端（frontend/apps/web/）

- **AssistantHome**：
  - 新会话状态（无消息）时，问候语与输入框之间渲染**卡片墙**：`GET /api/agents` →
    卡片（M3 tonal 圆形图标取 label 首字符、label、description 截断两行、"开始对话"）；
    卡片的 `agentDomain` 取 AgentInfo.id（agents 注册表的 key 即 domain）；
    点击 = 选中该智能体 + 聚焦输入框。自定义 Agent 无预置示例问题，卡片不显示示例区；
    保险卡片的示例问题沿用现有 EXAMPLES 挂在卡片下。
  - 对话进行中：输入框上方显示"当前智能体"胶囊（label），从历史会话恢复时按会话 `agentDomain` 显示。
  - `send()` body 携带 `agentDomain`；会话列表项显示智能体徽标（list 返回的 agentDomain）。
  - 纯函数抽离 `toAgentCards(agents)`（列表 → 卡片数据：图标字符、截断文案），配 Vitest。
- 经典问数页 `/chat` 不动。

## 5. 错误处理与兼容

| 场景 | 行为 |
|---|---|
| 所选 domain 不存在/被禁用 | 编排层元数据 404 → SSE error"该智能体暂不可用或未启用" + done 正常收尾，**不静默回退保险** |
| 元数据接口网络失败 | error"智能助手暂时无法确认所选智能体，请稍后重试" |
| 请求未带 agentDomain / 非法值 | 按 `insurance` 处理（老前端完全兼容） |
| 旧会话（无 agent_domain） | 视为 insurance；自愈补列后新会话正常记录 |
| 自定义 Agent 问数执行失败 | 走现有 ask_data 错误兜底路径 |
| 会话中途换 domain 请求 | 以会话绑定为准（请求参数仅对新会话首跳生效） |

## 6. 测试计划

- **编排层（Vitest）**：agent-meta 缓存/404/网络失败；toolsFactory 按 domain 组装
  （insurance 三工具、custom 一工具）；ask_data URL/描述随 domain 变化；会话 domain 锁定
  （老会话带不同 agentDomain 请求仍用绑定值）；提示词包含 label/description；
  sessions list/get 返回 agentDomain；PG 存储用既有 poolOverride 假池测补列与读写。
- **后端（pytest）**：`/internal/agents` 列表与单查（internal token 鉴权、custom 启用/停用变化）；
  assistant 代理透传 agentDomain 与非法值忽略。
- **前端（Vitest）**：`toAgentCards` 映射纯函数（图标字符、描述截断、空列表）。
- **E2E（手工）**：注册一个自定义 Agent → ≤30s 后首页卡片出现 → 点卡片提问 → 回答走该 Agent
  工程（SQL 表来自其白名单）→ 会话列表徽标正确 → 停用该 Agent → 首页提问报"暂不可用"。

## 7. 部署

backend / pi-orchestrator / web 三镜像，按既有本地构建 → save/gzip → 上传 → load →
`up -d` 流水线发布（生产 .env 无需新增配置项）。

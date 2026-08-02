# pi-wren-platform 架构

> 📌 当前已落地结构的**最终形态**见 [technical-architecture.md](technical-architecture.md)（结果版，含分层图/模块表/数据流）。
## 设计原则

- **执行层（Pi Agent Runtime 风格）**：Agent 流水线、工具注册、事件与记忆
- **上下文层（Wren Context Engine 风格）**：业务语义建模（MDL 式）、SQL 生成
- 两者结合：企业级自然语言数据问答平台

## 运行时架构（当前已实现）

```
用户
 │
Web Chat (Next.js :3000, /api 代理)
 │
Express API (:8080)
 │  ├─ GET /api/agents           Agent 列表
 │  ├─ POST /api/agent/:domain/chat          一次性 JSON
 │  └─ POST /api/agent/:domain/chat/stream   SSE 流式（执行事件实时推送）
 │
pi-bridge（services/pi-bridge，开源 Pi 会话层）
 │  ├─ PiSessionStore：基于 @earendil-works/pi-agent-core jsonl 会话仓库
 │  │    多轮持久化（data/sessions/*.jsonl）+ 历史注入
 │  └─ 压缩决策（pi shouldCompact/estimateTokens）+ SSE 事件协议
 │
DataAnalysisAgent（财务 / 保险，按领域配置驱动）
 │
 ├─ 语义层 ContextEngine
 │    ├─ LlmContextEngine   ← LLM 动态生成 SQL（OpenAI 兼容/Anthropic/Ollama）
 │    │    ├─ 提示词：表结构 + 业务知识 + 示例意图（来自 semantic/*.mdl.yml）
 │    │    └─ 安全校验：仅 SELECT/WITH、拦截高危语句、表名白名单
 │    └─ ConfigDrivenContextEngine ← 规则匹配（关键词评分→SQL 模板，降级兜底）
 │
 ├─ Agent Tools（工具注册）
 │    ├─ wren_generate_sql / database_query / result_analysis / wren_search_knowledge
 │    └─ llm_summarize（防幻觉提示词，逐字引用数据）
 │
 └─ 数据引擎 SqlExecutor → PostgreSQL（public schema，23 张表）
```

## 核心模块

### Agent Runtime（services/agent-runtime）

- `DataAnalysisAgent`：领域无关流水线（计划 → 语义 SQL → 查询 → 分析 → LLM 摘要），领域差异全部来自 `domain` 配置
- `ToolRegistry`：工具注册/执行；`LlmContextEngine` + `sql-validation`：LLM 动态 SQL 与安全校验
- 事件模型（plan/tool_call/tool_result/observation/answer/error）驱动前端执行轨迹
- `MemoryStore`：会话记忆抽象（默认 `PiSessionStore`，见下）
- `answer(question, { sessionId, onEvent })`：支持续聊（历史注入摘要）与事件流回调

### Context Engine（services/context-engine）

- `semantic/*.mdl.yml`：模型（表+列+注释）、意图（问题→SQL 模板）、指标定义、业务知识
- `ConfigDrivenContextEngine`：关键词评分匹配，零外部依赖
- `WrenContextEngine` / `WrenAIClient`：对接真实 Wren AI 服务（配置 `WREN_URL` 启用）
- 语义配置结构对齐 Wren AI 的 MDL 建模思路，便于未来迁移

### Pi 桥接（services/pi-bridge，方案 A：会话层接入）

- `PiSessionStore implements MemoryStore`：基于开源 Pi `JsonlSessionRepo` + `NodeExecutionEnv`，
  每条问答记录以 custom entry 追加到 session 文件（`data/sessions/`），重启不丢、天然多轮
- 多轮续聊：`getHistory(sessionId)` 按时间正序读取，Agent 摘要时注入最近 3 轮
- 压缩辅助：`estimateHistoryTokens` / `decideCompaction`（基于 pi `shouldCompact`）
- SSE 协议：`formatSseEvent` / `formatSseDone`，事件名与执行事件类型一致
- 接入原则：**问答仍走确定性流水线**，Pi 仅提供会话持久化 + 事件协议，安全边界不变

### 数据引擎（services/data-engine）

- PostgreSQL 连接池（`createPool`）、`SqlExecutor` 抽象（可注入测试替身）
- 财务：`finance_fact`；保险：契约/保全/理赔/客户/字典等 22 张生产级表（`infra/postgres/insurance_schema.sql`）

### LLM Provider（packages/agent-sdk）

- `OpenAIProvider`（兼容 DashScope/DeepSeek 等）、`AnthropicProvider`、`OllamaProvider`、`MockProvider`
- `LLM_PROVIDER=mock`：离线规则模式（零依赖 demo）；配置真实 Provider：LLM 生成 SQL + 摘要

## 企业流程示例

用户提问："各险种的赔付率如何？"

1. Agent 规划 → 语义层（LLM 或规则）生成 SQL（含 sys_dict 字典关联）
2. SQL 安全校验 → PostgreSQL 执行
3. 结果分析（时间序列环比 / 分组占比）
4. LLM 摘要（强制逐字引用数据，防止幻觉）→ 返回结论/关键指标/风险建议

## 长期目标

- 通用 Agent 运行时与工作流引擎
- 企业治理：RBAC、审计、数据权限
- 多数据源连接器与生产级部署

（演进清单见 [enterprise-roadmap.md](enterprise-roadmap.md)）

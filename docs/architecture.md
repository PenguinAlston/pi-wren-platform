# pi-wren-platform 架构

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
 │  └─ POST /api/agent/:domain/chat
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
- `MemoryStore`：会话记忆抽象（当前进程内实现，可替换 Redis/Postgres）

### Context Engine（services/context-engine）

- `semantic/*.mdl.yml`：模型（表+列+注释）、意图（问题→SQL 模板）、指标定义、业务知识
- `ConfigDrivenContextEngine`：关键词评分匹配，零外部依赖
- `WrenContextEngine` / `WrenAIClient`：对接真实 Wren AI 服务（配置 `WREN_URL` 启用）
- 语义配置结构对齐 Wren AI 的 MDL 建模思路，便于未来迁移

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

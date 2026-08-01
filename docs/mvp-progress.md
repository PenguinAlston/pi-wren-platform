# MVP 进展

> 状态更新：2026-08-02。MVP 骨架已完成工程化重构并通过全链路验证。
> 企业级演进清单见 [docs/enterprise-roadmap.md](enterprise-roadmap.md)。

## 已完成

- pnpm workspace 重构与统一工具链（ESLint / Prettier / Vitest / CI）
- LLM Provider 抽象与实现：OpenAI、Anthropic、Ollama、离线 Mock
- Wren 语义层：Wren AI 客户端 + demo SQL 生成 + 指标定义
- PostgreSQL 数据引擎与种子数据
- FinanceAgent 全链路：计划 → 语义 SQL → 查询 → 分析 → 摘要
- Express API（配置校验、日志、健康检查、错误处理、优雅停机）
- Next.js 聊天控制台（结论、执行轨迹、SQL、结果表）
- 端到端验证：Web → API → Agent → PostgreSQL 已跑通

## 目标流程（已实现）

```
User
 |
Web Chat
 |
Agent API
 |
Finance Agent (计划/工具/事件)
 |
Wren Context Engine → SQL
 |
PostgreSQL 数据引擎
 |
业务分析摘要
```

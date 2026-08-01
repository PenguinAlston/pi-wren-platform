# MVP 进展

> 状态：2026-08-02 更新。MVP 已从"骨架"演进为**可运行的自然语言数据问答平台**，全链路已用真实 LLM（阿里云 DashScope qwen3.7-flash）与真实 PostgreSQL 验证通过。企业级演进清单见 [enterprise-roadmap.md](enterprise-roadmap.md)。

## 已完成

### 核心链路（已跑通）
- [x] 中文自然语言 → LLM 动态生成 SQL → 安全校验 → PostgreSQL 执行 → 业务分析摘要
- [x] 财务 Agent（finance_fact 季度利润/收入/成本分析）
- [x] 保险 Agent（保单/理赔/保全/核保/赔付率，22 张生产级表 + 字典中文标签）
- [x] 规则引擎降级兜底（LLM 不可用或输出不安全时自动切换，查询不中断）
- [x] 防幻觉提示词（日期/数值逐字照抄，数据缺失如实说明）

### 平台能力
- [x] 多 Agent 架构：`DataAnalysisAgent` + 领域配置（domain + semantic YAML）
- [x] MDL 式语义引擎（模型/意图/指标/知识，YAML 配置驱动）
- [x] 前端控制台：Agent 切换、执行轨迹、SQL、结果表
- [x] API：`/api/agents`、`/api/agent/:domain/chat`、健康检查
- [x] 工程化：pnpm workspace、strict TS、ESLint/Prettier、Vitest 46 用例、CI、日志、配置校验

## 目标流程（已实现）

```
用户中文提问
 │
Web Chat → Express API
 │
DataAnalysisAgent（领域配置驱动）
 │
语义层（LLM 动态 SQL / 规则引擎兜底）→ 安全校验
 │
PostgreSQL（财务 + 保险 23 张表）
 │
结果分析 → LLM 摘要 → 回答 + 轨迹 + SQL + 结果表
```

## 遗留项（详见路线图）

- 认证/RBAC、审计落库、SQL 执行层硬约束、会话持久化、流式输出、图表可视化
- 传统业务查询界面（契约/保全/理赔条件组合查询 + 分页导出）
- 混合路由提速（常见问题 <1s）、生产部署

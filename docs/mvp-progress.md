# MVP 进展

> 状态：2026-08-02 更新。MVP 已从"骨架"演进为**可运行的自然语言数据问答平台 + 自助式自定义 Agent 平台**，全链路已用真实 LLM（阿里云 DashScope qwen3.7-flash）与真实 PostgreSQL 验证通过。企业级演进清单见 [enterprise-roadmap.md](enterprise-roadmap.md)。

## 已完成

### 核心链路（已跑通）
- [x] 中文自然语言 → LLM 动态生成 SQL → 安全校验 → PostgreSQL 执行 → 业务分析摘要
- [x] 财务 Agent（finance_fact 季度利润/收入/成本分析）
- [x] 保险 Agent（保单/理赔/保全/核保/赔付率，22 张生产级表 + 字典中文标签）
- [x] 规则引擎降级兜底（LLM 不可用或输出不安全时自动切换，查询不中断）
- [x] 防幻觉提示词（日期/数值逐字照抄，数据缺失如实说明）
- [x] SQL 安全校验（统一关口 `database_query`：字符串/注释防绕过、危险函数拦截、表名白名单自动来自 MDL；LLM/规则/Wren/自定义 Agent 全路径生效）

### 会话与流式（方案 A：开源 Pi 会话层）
- [x] 多轮会话持久化：基于 `@earendil-works/pi-agent-core` jsonl 会话仓库（`data/sessions/`，重启不丢）
- [x] 续聊历史注入：摘要时自动注入最近 3 轮对话
- [x] SSE 流式输出：`POST /api/agent/:domain/chat/stream`，前端实时轨迹
- [x] 压缩决策辅助（pi `shouldCompact`/`estimateTokens`）

### 自定义 Agent（Phase 1-3）
- [x] 自助注册：`POST /api/admin/agents`（MDL + 数据库连接串），无需改代码/重启
- [x] 连接串 AES-256-GCM 加密落库、管理面 `X-Admin-Token` 鉴权、列表脱敏
- [x] 运行时注册表：启动加载 + 动态增删改 + 单 Agent 失败隔离（status=error）
- [x] 多租户：`owner_id` 归属 + 列表 `?ownerId=` 过滤
- [x] 管理操作审计落库（`sys_operation_log`，主体 UADMIN，失败不阻断）
- [x] 连接池监控：`GET /api/admin/agents/:id/status`（total/idle/waiting），更新/注销自动释放
- [x] 前端管理页 `/agents`：MDL 粘贴、校验、连接测试、启停/编辑/删除、池监控
- [x] 示例模板 `examples/mdl-template.yml`

### 平台能力
- [x] 多 Agent 架构：`DataAnalysisAgent` + 领域配置（内置 domain + 自定义 MDL 两种来源）
- [x] MDL 式语义引擎（模型/意图/指标/知识，YAML 配置驱动）
- [x] 前端控制台：Agent 切换、执行轨迹、SQL、结果表、多轮续聊
- [x] AI 问答页 chat.qwen.ai 化（需求第 4 章）：左侧会话栏（新建/搜索/删除/重命名）、中间对话区（加载动画/历史回看/内容复制）、底部输入区（超长文本/清空会话）、错误重试；AI 回复含智能总结 + 自动图表（柱/折线/饼）+ 分页表格 + CSV 导出；会话管理 API `/api/sessions`
- [x] API：`/api/agents`、`/api/agent/:domain/chat`、SSE 流式、自定义 Agent 管理面、健康检查
- [x] 传统查询后端（需求第 3 章）：契约/保全/理赔多条件组合查询 + 详情 + CSV 导出 + 字典/机构联动（`/api/traditional/*`、`/api/dicts`、`/api/orgs`），出口统一脱敏（身份证/手机号）
- [x] 传统查询前端（`/query`）：顶部导航【传统查询】【AI 问答】+ 左侧模块切换 + 条件区（录入/下拉/日期/数值区间）+ 结果区（分页/排序/详情抽屉/导出）
- [x] 工程化：pnpm workspace、strict TS、ESLint/Prettier、Vitest 92 用例、CI、pino 日志（敏感头脱敏）、zod 配置
- [x] 生产构建：tsup CJS 单文件（修复 pg/yaml 等原生 CJS 依赖在 ESM bundle 的运行时错误）

## 目标流程（已实现）

```
用户中文提问
 │
Web Chat（:3000）→ Express API（:8080）
 │
DataAnalysisAgent（内置 财务/保险 + 自定义 Agent 注册表）
 │
语义层（LLM 动态 SQL / 规则引擎兜底）→ 安全校验（表名白名单）
 │
PostgreSQL（内置 23 张表 + 自定义 Agent 独立连接池）
 │
结果分析 → LLM 摘要（历史注入）→ SSE 实时轨迹 + 回答 + SQL + 结果表
 │
会话 jsonl 持久化（pi）+ 管理操作审计（sys_operation_log）
```

## 遗留项（详见路线图）

- 认证/RBAC（当前管理面用轻量 `X-Admin-Token`）
- AI 问答/传统查询的审计接入（当前仅自定义 Agent 管理操作）
- 行级/列级数据权限（只读事务/语句超时/行数上限已完成）
- 传统业务查询前端页面（后端 API 已完成；前端三张查询页已完成：模块切换/条件组合/分页排序/详情抽屉/CSV 导出）
- AI 会话权限隔离（当前无认证，会话全局可见）、会话数据入库 `ai_chat_session`（当前 jsonl 落盘）
- 混合路由提速（常见问题 <1s）、LLM 摘要 token 级流式、生产部署（Dockerfile）

# 自定义 Agent 功能设计（自带 MDL + 数据库连接串）

> **状态：Phase 1-3 已落地（2026-08）**
> - Phase 1：`services/agent-registry` + `sys_agent_config` + 管理 API（注册/加载/更新/注销/错误隔离/加密/脱敏）
> - Phase 2：前端管理页 `http://localhost:3000/agents`（MDL 校验、连接测试、启停/编辑/删除、池监控）+ 示例模板 `examples/mdl-template.yml`
> - Phase 3：多租户 `owner_id`（列表按 owner 过滤）、管理操作审计落库 `sys_operation_log`（主体 `UADMIN`，失败不阻断）、连接池监控 `GET /api/admin/agents/:id/status`（total/idle/waiting）
>
> 目标：对外提供自助式 Agent 创建能力 —— 用户提供一份 MDL（YAML 语义配置）和
> 一个数据库连接串，即可注册一个专属的自然语言查询 Agent，无需改代码、无需重新部署。
>
> 现状支撑：现有架构已是**配置驱动**（`parseSemanticConfig` 可解析字符串 MDL、
> SQL 校验表名白名单来自 `SemanticConfig.models[].table`、`createPool(config)` 支持独立连接），
> 因此该功能主要是补齐"持久化 + 注册表 + 管理 API + 安全壳"。

## 一、使用流程（对外能力）

1. 管理员/用户通过管理 API（或后续管理界面）提交：
   - `name` / `label` / `description`
   - `mdl`：MDL YAML 原文（模型 = 表+列，意图 = 问题→SQL 模板，指标、知识）
   - `db`：PostgreSQL 连接配置（host/port/database/user/password）或标准连接串
   - `systemPrompt`（可选，缺省按行业模板生成）
2. 系统校验：MDL 语法/结构 → 连接可用性（`SELECT 1`）→ 保存（连接串加密）
3. 系统动态构建 Agent 实例并注册 → 立即出现在 `GET /api/agents` 和聊天页
4. 用户即可按 `/api/agent/:agentId/chat` 提问；后续可更新/停用/删除

## 二、数据模型（新增表 `sys_agent_config`）

```sql
CREATE TABLE sys_agent_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        VARCHAR(64) UNIQUE NOT NULL,   -- 路由用短 id（如 my-erp）
  name            VARCHAR(128) NOT NULL,          -- 展示名
  label           VARCHAR(128) NOT NULL,
  description     TEXT,
  system_prompt   TEXT,                           -- 可选，缺省按模板
  mdl             TEXT NOT NULL,                  -- MDL YAML 原文（注册时已校验）
  db_connection_enc TEXT NOT NULL,                -- AES-256-GCM 加密的连接配置 JSON
  status          VARCHAR(16) NOT NULL DEFAULT 'enabled', -- enabled | disabled | error
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 建议放到 infra/postgres/（与 sys_operation_log 同库），并预留
-- owner_id 列（多租户/RBAC 落地时启用）
```

## 三、管理 API（新路由）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/agents` | 注册：校验 MDL + 测试连接 + 加密保存 + 构建实例 |
| GET | `/api/admin/agents` | 全部配置列表（连接信息脱敏） |
| GET | `/api/admin/agents/:id` | 详情（脱敏） |
| PUT | `/api/admin/agents/:id` | 更新（重建实例，旧连接池关闭） |
| DELETE | `/api/admin/agents/:id` | 注销（释放连接池） |
| POST | `/api/admin/agents/:id/test` | 单独测试连接 |
| POST | `/api/admin/agents/validate` | 仅校验 MDL（前端实时校验用，不落库） |

- 管理路由用 `X-Admin-Token` 与 `env ADMIN_TOKEN` 比对（P1 RBAC 之前的轻量闸门）
- 请求体 zod 校验：`mdl` 上限 256KB；`agent_id` 只允许 `[a-z0-9-]` 且唯一
- 列表/详情返回时 `db_connection_enc` 解密后**只回传掩码**（如 `***@host:port/db`）

## 四、运行时架构（AgentRegistry 替代硬编码 DOMAINS）

```
buildDeps
 ├─ 内置 finance/insurance（保持现状，来源=builtin）
 └─ AgentRegistry.loadCustomAgents()
      └─ 遍历 sys_agent_config(status=enabled)
           └─ for each:
                parseSemanticConfig(mdl)        → SemanticConfig
                decryptDbConnection()           → DatabaseConfig
                createPool({..., max: 3, statement_timeout: 15000})
                new ConfigDrivenContextEngine(semantic)      // 规则兜底
                new LlmContextEngine({ model, config, fallback })  // LLM 动态 SQL
                new DataAnalysisAgent({ domain, context, sql, tools, model, memory })
                （LLM 用平台共享 provider；SQL 校验白名单自动来自 mdl models）
```

- `AgentSpec` 增加 `source: 'builtin' | 'custom'`，`GET /api/agents` 合并返回
- 注册表支持**运行时增删改**：注册/更新/删除后无需重启
- 单个 Agent 构建失败 → `status=error + last_error`，**不影响其他 Agent**（错误隔离）
- 会话隔离：PiSessionStore 按 `agent_id` 分目录（如 `data/sessions/<agent_id>/`），互不串扰

## 五、安全设计（核心）

1. **连接串加密**：AES-256-GCM（node:crypto），密钥派生自 `env AGENT_SECRET_KEY`（≥32 字节）。
   未配置该密钥时注册接口返回 503"平台未开启自定义 Agent"。
2. **只读强制（生成+校验层已有）**：LLM 只允许生成 SELECT/WITH；`sql-validation` 拦截高危关键字、
   多语句，表名白名单 = MDL 声明的 models + sys_dict —— 自定义 Agent **自动继承**。
3. **执行层加固（沿用 P1 计划）**：注册时提示/要求使用只读数据库账号；
   连接池设置 `statement_timeout`、行数上限（P1 在数据库层强制只读事务）。
4. **资源限制**：每自定义 Agent 连接池 `max: 3`、连接超时 5s、语句超时 15s；
   连接测试超时 5s；单库白名单（禁连系统库提示）。
5. **管理面认证**：`ADMIN_TOKEN`（环境变量）+ `X-Admin-Token`；正式 RBAC 上线后替换。
6. **输入校验**：MDL 大小/结构校验、`agent_id` 格式、YAML 解析失败即拒绝。

## 六、前端（第二期，可选）

- 新增 `/agents` 管理页：表单（名称、MDL 粘贴框、连接配置、测试连接按钮、保存）
- 聊天页无需改动：`GET /api/agents` 已动态返回自定义 Agent
- 管理页操作按钮：测试连接 / 启用停用 / 编辑 / 删除

## 七、迁移与兼容

- 内置 finance/insurance **保持代码内注册**（`source=builtin`），不迁移表，避免破坏现有行为
- `GET /api/agents` 响应结构向后兼容（新增 `source` 字段）
- 老 chat 路由 `/api/agent/chat`（默认财务）行为不变

## 八、实施分期与验收

### Phase 1（核心，推荐先做）
- 表 `sys_agent_config` + 加密工具（`services/pi-bridge` 或新 `services/agent-registry`）
- `AgentRegistry`（加载/构建/销毁 + 错误隔离）
- 管理 API 全部 7 个端点 + `ADMIN_TOKEN` + 脱敏
- 单元/集成测试：MDL 校验、加密脱敏、注册→问答全流程（mock 连接）、白名单生效、错误隔离

### Phase 2（体验）
- 前端管理页 + 聊天页自定义 Agent 展示
- 示例 MDL 模板与文档（用户上手文档）

### Phase 3（企业级）
- 多租户（owner_id）、细粒度权限、连接池监控、审计（sys_operation_log 记录注册/变更）

### 验收标准
- 不重启服务即可注册一个全新 Agent 并立即问答
- 自定义 Agent 的 SQL 校验白名单只含其 MDL 声明的表
- 连接串密文落库，任何接口不回显明文
- 一个 Agent 配置错误不影响其他 Agent 与内置 Agent

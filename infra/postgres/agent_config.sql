-- 自定义 Agent 配置表：用户自带 MDL + 数据库连接串注册专属查询 Agent
CREATE TABLE IF NOT EXISTS sys_agent_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         VARCHAR(64) UNIQUE NOT NULL,  -- 路由用短 id（如 my-erp）
  name             VARCHAR(128) NOT NULL,        -- 展示名
  label            VARCHAR(128) NOT NULL,
  description      TEXT,
  system_prompt    TEXT,                         -- 可选，缺省按平台模板
  mdl              TEXT NOT NULL,                -- MDL YAML 原文（注册时已校验）
  db_connection_enc TEXT NOT NULL,               -- AES-256-GCM 加密的连接配置 JSON
  status           VARCHAR(16) NOT NULL DEFAULT 'enabled',  -- enabled | disabled | error
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 预留：多租户/RBAC 落地时启用
-- ALTER TABLE sys_agent_config ADD COLUMN IF NOT EXISTS owner_id VARCHAR(64);

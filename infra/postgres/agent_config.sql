-- 自定义 Agent 配置表：用户自带 WrenAI 工程 JSON + 数据库连接串注册专属查询 Agent
CREATE TABLE IF NOT EXISTS sys_agent_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         VARCHAR(64) UNIQUE NOT NULL,  -- 路由用短 id（如 my-erp）
  name             VARCHAR(128) NOT NULL,        -- 展示名
  label            VARCHAR(128) NOT NULL,
  description      TEXT,
  system_prompt    TEXT,                         -- 可选，缺省按平台模板
  project_json     TEXT NOT NULL,                -- WrenAI 工程序列化 JSON（wren context init --from-mdl 产出的 MDL JSON）
  db_connection_enc TEXT NOT NULL,               -- AES-256-GCM 加密的连接配置 JSON
  status           VARCHAR(16) NOT NULL DEFAULT 'enabled',  -- enabled | disabled | error
  last_error       TEXT,
  owner_id         VARCHAR(64),                  -- 多租户归属（RBAC 落地后由登录身份解析）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 已存在表的迁移（幂等）：
-- 1. owner_id（早期版本）
ALTER TABLE sys_agent_config ADD COLUMN IF NOT EXISTS owner_id VARCHAR(64);

-- 2. mdl → project_json（完全拥抱 WrenAI 后的列重命名）
--    若旧 mdl 列存在则改名；新部署直接建 project_json。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sys_agent_config' AND column_name = 'mdl'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sys_agent_config' AND column_name = 'project_json'
  ) THEN
    ALTER TABLE sys_agent_config RENAME COLUMN mdl TO project_json;
  END IF;
END $$;

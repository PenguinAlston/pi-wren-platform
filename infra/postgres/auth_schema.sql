-- ---------------------------------------------------------------------
-- 用户认证（AUTH_ENABLED=true 时启用）
-- 存量库无需手工迁移：后端启动时 UserStore.ensure_table 会补建本表
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sys_login_user (
    user_id       varchar(64) PRIMARY KEY,
    username      varchar(64) NOT NULL UNIQUE,
    password_hash text NOT NULL,                    -- pbkdf2_sha256$<iter>$<salt>$<hash>
    display_name  varchar(128),
    role          varchar(16) NOT NULL DEFAULT 'user',   -- admin | user
    status        varchar(16) NOT NULL DEFAULT 'active', -- active | disabled
    org_id        varchar(64),                           -- 所属机构（行级数据权限；admin/NULL = 不限）
    created_at    timestamp DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN sys_login_user.org_id IS '所属机构（引用 sys_org.org_id，逻辑外键）；行级数据权限，admin/NULL 不限';

COMMENT ON TABLE sys_login_user IS '登录用户（PBKDF2 口令；初始管理员由 AUTH_ADMIN_* 配置在首次启动时引导创建）';

CREATE INDEX IF NOT EXISTS idx_sys_login_user_username ON sys_login_user(username);

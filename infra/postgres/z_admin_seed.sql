-- 平台管理用户：自定义 Agent 管理操作审计主体（依赖 sys_user 表，故以 z_ 前缀保证在保险 schema 之后执行）
INSERT INTO sys_user (user_id, user_account, user_name, org_id, user_type, status)
VALUES ('UADMIN', 'platform', '平台管理', 'ORG0001', '99', '1')
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================================
-- 保险核心业务系统表结构（依据需求文档 第5章 生产级全量合规版）
-- 十二大业务域：系统基础 / 产品费率 / 客户 / 契约 / 保全 / 理赔
-- 说明：datetime -> timestamp；longtext -> text
-- =====================================================================

-- 清理旧版 demo 表（文档版表结构以 ins_ 前缀为准）
DROP TABLE IF EXISTS insurance_payment CASCADE;
DROP TABLE IF EXISTS insurance_claim CASCADE;
DROP TABLE IF EXISTS insurance_policy CASCADE;

-- ---------------------------------------------------------------------
-- 5.1 系统基础公共域
-- ---------------------------------------------------------------------

CREATE TABLE sys_dict (
    dict_id     varchar(64) PRIMARY KEY,
    dict_type   varchar(32) NOT NULL,
    dict_label  varchar(64) NOT NULL,
    dict_value  varchar(32) NOT NULL,
    sort_num    integer DEFAULT 0,
    status      char(1) DEFAULT '1',
    remark      varchar(512)
);
COMMENT ON TABLE sys_dict IS '业务字典表：全系统下拉枚举（险种/状态/渠道等），AI解析字段释义统一';

CREATE TABLE sys_org (
    org_id          varchar(64) PRIMARY KEY,
    org_name        varchar(128) NOT NULL,
    org_short_name  varchar(64),
    parent_org_id   varchar(64),
    org_level       char(1) NOT NULL,
    area_code       varchar(32) NOT NULL,
    status          char(1) DEFAULT '1',
    create_time     timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE sys_org IS '机构信息表：总公司/分公司/支公司/网点四级机构';
COMMENT ON COLUMN sys_org.org_level IS '机构层级：1-总公司 2-分公司 3-支公司 4-网点';

CREATE TABLE sys_user (
    user_id          varchar(64) PRIMARY KEY,
    user_account     varchar(32) NOT NULL UNIQUE,
    user_name        varchar(50) NOT NULL,
    org_id           varchar(64) NOT NULL REFERENCES sys_org(org_id),
    user_type        char(2) NOT NULL,
    status           char(1) DEFAULT '1',
    last_login_time  timestamp
);
COMMENT ON TABLE sys_user IS '系统用户表：员工/审核/运维账号';
COMMENT ON COLUMN sys_user.user_type IS '用户类型：01-运营 02-核保 03-理赔 04-管理员';

CREATE TABLE sys_operation_log (
    log_id        varchar(64) PRIMARY KEY,
    user_id       varchar(64) NOT NULL REFERENCES sys_user(user_id),
    oper_type     varchar(32) NOT NULL,
    oper_content  varchar(1024) NOT NULL,
    sql_content   text,
    oper_time     timestamp DEFAULT CURRENT_TIMESTAMP,
    ip_address    varchar(64)
);
COMMENT ON TABLE sys_operation_log IS '系统操作日志：传统查询/AI问答/导出/详情查看审计';

CREATE TABLE ai_chat_session (
    session_id    varchar(64) PRIMARY KEY,
    user_id       varchar(64) NOT NULL REFERENCES sys_user(user_id),
    session_name  varchar(128),
    chat_content  text NOT NULL,
    create_time   timestamp DEFAULT CURRENT_TIMESTAMP,
    update_time   timestamp DEFAULT CURRENT_TIMESTAMP,
    is_delete     char(1) DEFAULT '0'
);
COMMENT ON TABLE ai_chat_session IS 'AI会话记录：多轮对话上下文与权限隔离';

-- ---------------------------------------------------------------------
-- 5.2 产品费率业务域
-- ---------------------------------------------------------------------

CREATE TABLE ins_product_main (
    product_id        varchar(64) PRIMARY KEY,
    product_name      varchar(128) NOT NULL,
    product_type      varchar(32) NOT NULL,
    product_status    char(2) NOT NULL,
    insure_age_range  varchar(64) NOT NULL,
    pay_year_list     varchar(128) NOT NULL,
    insure_period     varchar(64) NOT NULL,
    register_date     date NOT NULL
);
COMMENT ON TABLE ins_product_main IS '保险产品主表：在售/停售产品基础信息';
COMMENT ON COLUMN ins_product_main.product_type IS '产品类型：重疾/医疗/意外/寿险/年金/财产险';

CREATE TABLE ins_product_rate (
    rate_id     varchar(64) PRIMARY KEY,
    product_id  varchar(64) NOT NULL REFERENCES ins_product_main(product_id),
    insure_age  integer NOT NULL,
    gender      char(1) NOT NULL,
    pay_year    varchar(32) NOT NULL,
    sum_insure  numeric(18,2) NOT NULL,
    year_pay    numeric(18,2) NOT NULL
);
COMMENT ON TABLE ins_product_rate IS '产品费率表：年龄/性别/缴费年限对应费率';
COMMENT ON COLUMN ins_product_rate.gender IS '性别：1-男 2-女';

-- ---------------------------------------------------------------------
-- 5.3 客户信息业务域
-- ---------------------------------------------------------------------

CREATE TABLE ins_customer (
    customer_id      varchar(64) PRIMARY KEY,
    customer_name    varchar(50) NOT NULL,
    id_type          char(1) NOT NULL,
    id_no            varchar(32) NOT NULL UNIQUE,
    gender           char(1),
    birthday         date,
    phone            varchar(20),
    address          varchar(255),
    customer_status  char(1) DEFAULT '0',
    create_time      timestamp DEFAULT CURRENT_TIMESTAMP,
    update_time      timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ins_customer IS '客户信息主表：投保人/被保人/受益人统一客户数据';
COMMENT ON COLUMN ins_customer.id_type IS '证件类型：1-身份证 2-护照 3-军官证';
COMMENT ON COLUMN ins_customer.customer_status IS '客户状态：0-正常 1-失效';

-- ---------------------------------------------------------------------
-- 5.4 契约保单业务域（完整保单生命周期）
-- ---------------------------------------------------------------------

CREATE TABLE ins_policy_main (
    policy_id         varchar(64) PRIMARY KEY,
    policy_no         varchar(64) NOT NULL UNIQUE,
    product_id        varchar(64) NOT NULL REFERENCES ins_product_main(product_id),
    product_type      varchar(32) NOT NULL,
    product_name      varchar(128) NOT NULL,
    policy_status     char(2) NOT NULL,
    applicant_id      varchar(64) NOT NULL REFERENCES ins_customer(customer_id),
    insured_id        varchar(64) NOT NULL REFERENCES ins_customer(customer_id),
    apply_date        date NOT NULL,
    effect_date       date,
    end_date          date,
    year_premium      numeric(18,2) NOT NULL,
    total_premium     numeric(18,2) NOT NULL,
    total_amount      numeric(18,2) NOT NULL,
    pay_type          char(1) NOT NULL,
    pay_year          integer NOT NULL,
    insure_period     varchar(64) NOT NULL,
    org_code          varchar(64) NOT NULL REFERENCES sys_org(org_id),
    channel_type      varchar(32) NOT NULL,
    agent_id          varchar(64),
    underwrite_result char(2) NOT NULL,
    surrender_date    date,
    create_time       timestamp DEFAULT CURRENT_TIMESTAMP,
    update_time       timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ins_policy_main IS '保单主表：契约业务核心主表';
COMMENT ON COLUMN ins_policy_main.policy_status IS '保单状态：01-待核保 02-承保有效 03-暂保单 04-已退保 05-已终止 06-已失效';
COMMENT ON COLUMN ins_policy_main.pay_type IS '缴费方式：1-年交 2-月交 3-趸交 4-季交';
COMMENT ON COLUMN ins_policy_main.underwrite_result IS '核保结果：01-通过 02-拒保 03-延期 04-加费承保';
CREATE INDEX idx_policy_status ON ins_policy_main(policy_status);
CREATE INDEX idx_policy_product ON ins_policy_main(product_type);
CREATE INDEX idx_policy_org ON ins_policy_main(org_code);

CREATE TABLE ins_policy_rider (
    rider_id            varchar(64) PRIMARY KEY,
    policy_id           varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    rider_product_id    varchar(64) NOT NULL,
    rider_product_name  varchar(128) NOT NULL,
    rider_premium       numeric(18,2) NOT NULL,
    rider_amount        numeric(18,2) NOT NULL,
    rider_status        char(2) NOT NULL,
    effect_date         date NOT NULL,
    end_date            date NOT NULL
);
COMMENT ON TABLE ins_policy_rider IS '附加险关联表：主险关联多附加险';

CREATE TABLE ins_policy_pay_log (
    pay_log_id         varchar(64) PRIMARY KEY,
    policy_id          varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    pay_period         integer NOT NULL,
    should_pay_amount  numeric(18,2) NOT NULL,
    actual_pay_amount  numeric(18,2) DEFAULT 0,
    pay_deadline       date NOT NULL,
    pay_time           timestamp,
    pay_status         char(2) NOT NULL,
    pay_channel        varchar(32)
);
COMMENT ON TABLE ins_policy_pay_log IS '保单缴费记录表：缴费明细/欠费统计';
COMMENT ON COLUMN ins_policy_pay_log.pay_status IS '缴费状态：01-待缴费 02-已缴费 03-欠费 04-补缴完成';

CREATE TABLE ins_policy_underwrite (
    underwrite_id      varchar(64) PRIMARY KEY,
    policy_id          varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    underwrite_user    varchar(64) NOT NULL REFERENCES sys_user(user_id),
    underwrite_time    timestamp NOT NULL,
    underwrite_type    char(2) NOT NULL,
    underwrite_result  char(2) NOT NULL,
    add_fee_rate       numeric(5,2) DEFAULT 0,
    underwrite_opinion varchar(1024)
);
COMMENT ON TABLE ins_policy_underwrite IS '保单核保记录表：核保审核/风控核查';
COMMENT ON COLUMN ins_policy_underwrite.underwrite_type IS '核保类型：01-智能核保 02-人工核保';
COMMENT ON COLUMN ins_policy_underwrite.underwrite_result IS '核保结果：01-通过 02-拒保 03-延期 04-加费承保';

CREATE TABLE ins_policy_benefit (
    benefit_id      varchar(64) PRIMARY KEY,
    policy_id       varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    customer_id     varchar(64) NOT NULL REFERENCES ins_customer(customer_id),
    relation_type   char(2) NOT NULL,
    benefit_rate    numeric(5,2) NOT NULL,
    benefit_level   char(1) NOT NULL,
    benefit_status  char(1) DEFAULT '1'
);
COMMENT ON TABLE ins_policy_benefit IS '保单受益人明细表：多受益人/比例拆分';
COMMENT ON COLUMN ins_policy_benefit.benefit_level IS '受益等级：1-第一顺位 2-第二顺位';

CREATE TABLE ins_policy_surrender (
    surrender_id       varchar(64) PRIMARY KEY,
    policy_id          varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    surrender_type     char(2) NOT NULL,
    apply_time         timestamp NOT NULL,
    audit_time         timestamp,
    cash_value         numeric(18,2) NOT NULL,
    surrender_amount   numeric(18,2) NOT NULL,
    surrender_status   char(2) NOT NULL,
    surrender_reason   varchar(512)
);
COMMENT ON TABLE ins_policy_surrender IS '保单退保记录表：退保专项业务';
COMMENT ON COLUMN ins_policy_surrender.surrender_type IS '退保类型：01-全额退保 02-部分退保 03-犹豫期退保';
COMMENT ON COLUMN ins_policy_surrender.surrender_status IS '退保状态：01-待审核 02-审核通过 03-已退款 04-驳回';

-- ---------------------------------------------------------------------
-- 5.3 保全业务域（全场景保单变更）
-- ---------------------------------------------------------------------

CREATE TABLE ins_preserve_main (
    preserve_id       varchar(64) PRIMARY KEY,
    policy_id         varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    preserve_type     varchar(32) NOT NULL,
    preserve_status   char(2) NOT NULL,
    apply_customer_id varchar(64) NOT NULL REFERENCES ins_customer(customer_id),
    apply_time        timestamp NOT NULL,
    audit_time        timestamp,
    audit_user_id     varchar(64) REFERENCES sys_user(user_id),
    audit_opinion     varchar(512),
    change_desc       varchar(1024),
    org_code          varchar(32) NOT NULL,
    create_time       timestamp DEFAULT CURRENT_TIMESTAMP,
    update_time       timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ins_preserve_main IS '保全主表：保单变更核心主表';
COMMENT ON COLUMN ins_preserve_main.preserve_type IS '保全类型：01-信息变更 02-缴费变更 03-受益人变更 04-保额调整 05-保单复效 06-保单挂失 07-退保申请';
COMMENT ON COLUMN ins_preserve_main.preserve_status IS '保全状态：01-待审核 02-审核通过 03-审核驳回 04-已办结 05-已撤销';

CREATE TABLE ins_preserve_detail (
    detail_id    varchar(64) PRIMARY KEY,
    preserve_id  varchar(64) NOT NULL REFERENCES ins_preserve_main(preserve_id),
    field_name   varchar(32) NOT NULL,
    field_desc   varchar(64) NOT NULL,
    old_value    varchar(255),
    new_value    varchar(255),
    change_time  timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ins_preserve_detail IS '保全变更明细表：前后字段数据变动追溯';

CREATE TABLE ins_preserve_fee (
    fee_id        varchar(64) PRIMARY KEY,
    preserve_id   varchar(64) NOT NULL REFERENCES ins_preserve_main(preserve_id),
    old_premium   numeric(18,2) NOT NULL,
    new_premium   numeric(18,2) NOT NULL,
    old_amount    numeric(18,2) NOT NULL,
    new_amount    numeric(18,2) NOT NULL,
    adjust_fee    numeric(18,2) NOT NULL,
    fee_status    char(1) NOT NULL
);
COMMENT ON TABLE ins_preserve_fee IS '保单保全费用变更表：保费/保额调整';
COMMENT ON COLUMN ins_preserve_fee.fee_status IS '费用状态：0-待补缴 1-已结清 2-退费完成';

CREATE TABLE ins_preserve_benefit (
    benefit_preserve_id varchar(64) PRIMARY KEY,
    preserve_id         varchar(64) NOT NULL REFERENCES ins_preserve_main(preserve_id),
    old_benefit_id      varchar(64),
    new_customer_id     varchar(64) NOT NULL REFERENCES ins_customer(customer_id),
    new_relation        char(2) NOT NULL,
    new_rate            numeric(5,2) NOT NULL,
    change_effect_time  timestamp NOT NULL
);
COMMENT ON TABLE ins_preserve_benefit IS '保全受益人变更表：受益人变更追溯';

CREATE TABLE ins_preserve_status (
    status_id             varchar(64) PRIMARY KEY,
    preserve_id           varchar(64) NOT NULL REFERENCES ins_preserve_main(preserve_id),
    old_policy_status     char(2) NOT NULL,
    new_policy_status     char(2) NOT NULL,
    status_change_reason  varchar(512),
    effect_time           timestamp NOT NULL
);
COMMENT ON TABLE ins_preserve_status IS '保单复效/失效保全表：状态变更专项';

-- ---------------------------------------------------------------------
-- 5.4 理赔业务域（全维度对齐契约模块）
-- ---------------------------------------------------------------------

CREATE TABLE ins_claim_main (
    claim_id             varchar(64) PRIMARY KEY,
    policy_id            varchar(64) NOT NULL REFERENCES ins_policy_main(policy_id),
    claim_type           varchar(32) NOT NULL,
    claim_status         char(2) NOT NULL,
    insured_id           varchar(64) NOT NULL REFERENCES ins_customer(customer_id),
    accident_time        timestamp NOT NULL,
    report_time          timestamp NOT NULL,
    accident_area        varchar(128),
    apply_claim_amount   numeric(18,2) NOT NULL,
    actual_claim_amount  numeric(18,2) DEFAULT 0,
    close_time           timestamp,
    claim_reason         varchar(512),
    org_code             varchar(32) NOT NULL,
    create_time          timestamp DEFAULT CURRENT_TIMESTAMP,
    update_time          timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ins_claim_main IS '理赔主表：报案/出险/审核/结案全流程';
COMMENT ON COLUMN ins_claim_main.claim_type IS '理赔类型：医疗/重疾/意外/身故/伤残/财产理赔';
COMMENT ON COLUMN ins_claim_main.claim_status IS '理赔状态：01-待立案 02-待查勘 03-审核中 04-赔付中 05-已结案 06-拒赔 07-撤销报案';
CREATE INDEX idx_claim_status ON ins_claim_main(claim_status);
CREATE INDEX idx_claim_policy ON ins_claim_main(policy_id);

CREATE TABLE ins_claim_pay (
    pay_id          varchar(64) PRIMARY KEY,
    claim_id        varchar(64) NOT NULL REFERENCES ins_claim_main(claim_id),
    pay_amount      numeric(18,2) NOT NULL,
    pay_time        timestamp NOT NULL,
    pay_status      char(1) NOT NULL,
    pay_channel     varchar(32),
    pay_order_no    varchar(64)
);
COMMENT ON TABLE ins_claim_pay IS '理赔赔付明细表：分笔赔付/结算';
COMMENT ON COLUMN ins_claim_pay.pay_status IS '赔付状态：0-待支付 1-支付成功 2-支付失败';

CREATE TABLE ins_claim_audit (
    audit_id         varchar(64) PRIMARY KEY,
    claim_id         varchar(64) NOT NULL REFERENCES ins_claim_main(claim_id),
    audit_stage      varchar(32) NOT NULL,
    audit_user_id    varchar(64) NOT NULL REFERENCES sys_user(user_id),
    audit_result     char(2) NOT NULL,
    audit_opinion    varchar(512),
    audit_time       timestamp DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE ins_claim_audit IS '理赔审核记录表：立案/查勘/复核/终审';
COMMENT ON COLUMN ins_claim_audit.audit_stage IS '审核阶段：立案审核/查勘审核/赔付复核/终审';
COMMENT ON COLUMN ins_claim_audit.audit_result IS '审核结果：01-通过 02-驳回 03-待补充资料';

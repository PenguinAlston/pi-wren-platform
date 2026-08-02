-- 保险核心业务 demo 种子数据（与需求文档业务域一致）
-- 注意：以下身份证号/手机号均为演示用途的虚构数据

-- ---- 机构 ----
INSERT INTO sys_org (org_id, org_name, org_short_name, parent_org_id, org_level, area_code, status) VALUES
('ORG0001',   '某某保险总公司',           '总公司',   NULL,        '1', '110000', '1'),
('ORG0101',   '北京分公司',               '北京分',   'ORG0001',   '2', '110100', '1'),
('ORG0201',   '上海分公司',               '上海分',   'ORG0001',   '2', '310100', '1'),
('ORG010101', '北京朝阳支公司',           '朝阳支',   'ORG0101',   '3', '110105', '1'),
('ORG020101', '上海浦东支公司',           '浦东支',   'ORG0201',   '3', '310115', '1')
ON CONFLICT DO NOTHING;

-- ---- 用户 ----
INSERT INTO sys_user (user_id, user_account, user_name, org_id, user_type, status) VALUES
('U001', 'ops001',   '张运营', 'ORG0001',  '01', '1'),
('U002', 'uw001',    '李核保', 'ORG0101',  '02', '1'),
('U003', 'claim001', '王理赔', 'ORG0101',  '03', '1'),
('U004', 'admin001', '赵管理', 'ORG0001',  '04', '1')
ON CONFLICT DO NOTHING;

-- ---- 业务字典 ----
INSERT INTO sys_dict (dict_id, dict_type, dict_label, dict_value, sort_num, status, remark) VALUES
('DICT-PT-01', 'product_type', '重疾险', '01', 1, '1', '险种类型'),
('DICT-PT-02', 'product_type', '医疗险', '02', 2, '1', '险种类型'),
('DICT-PT-03', 'product_type', '意外险', '03', 3, '1', '险种类型'),
('DICT-PT-04', 'product_type', '寿险',   '04', 4, '1', '险种类型'),
('DICT-PT-05', 'product_type', '年金险', '05', 5, '1', '险种类型'),
('DICT-PT-06', 'product_type', '财产险', '06', 6, '1', '险种类型'),
('DICT-PS-01', 'policy_status', '待核保',   '01', 1, '1', '保单状态'),
('DICT-PS-02', 'policy_status', '承保有效', '02', 2, '1', '保单状态'),
('DICT-PS-03', 'policy_status', '暂保单',   '03', 3, '1', '保单状态'),
('DICT-PS-04', 'policy_status', '已退保',   '04', 4, '1', '保单状态'),
('DICT-PS-05', 'policy_status', '已终止',   '05', 5, '1', '保单状态'),
('DICT-PS-06', 'policy_status', '已失效',   '06', 6, '1', '保单状态'),
('DICT-CS-01', 'claim_status',  '待立案',   '01', 1, '1', '理赔状态'),
('DICT-CS-02', 'claim_status',  '待查勘',   '02', 2, '1', '理赔状态'),
('DICT-CS-03', 'claim_status',  '审核中',   '03', 3, '1', '理赔状态'),
('DICT-CS-04', 'claim_status',  '赔付中',   '04', 4, '1', '理赔状态'),
('DICT-CS-05', 'claim_status',  '已结案',   '05', 5, '1', '理赔状态'),
('DICT-CS-06', 'claim_status',  '拒赔',     '06', 6, '1', '理赔状态'),
('DICT-CS-07', 'claim_status',  '撤销报案', '07', 7, '1', '理赔状态'),
('DICT-PV-01', 'preserve_type', '信息变更',   '01', 1, '1', '保全类型'),
('DICT-PV-02', 'preserve_type', '缴费变更',   '02', 2, '1', '保全类型'),
('DICT-PV-03', 'preserve_type', '受益人变更', '03', 3, '1', '保全类型'),
('DICT-PV-04', 'preserve_type', '保额调整',   '04', 4, '1', '保全类型'),
('DICT-PV-05', 'preserve_type', '保单复效',   '05', 5, '1', '保全类型'),
('DICT-PV-06', 'preserve_type', '保单挂失',   '06', 6, '1', '保全类型'),
('DICT-PV-07', 'preserve_type', '退保申请',   '07', 7, '1', '保全类型'),
('DICT-CH-01', 'channel_type',  '线下网点',   '01', 1, '1', '投保渠道'),
('DICT-CH-02', 'channel_type',  '代理人',     '02', 2, '1', '投保渠道'),
('DICT-CH-03', 'channel_type',  '线上官网',   '03', 3, '1', '投保渠道'),
('DICT-CH-04', 'channel_type',  '第三方平台', '04', 4, '1', '投保渠道'),
('DICT-CH-05', 'channel_type',  '电销',       '05', 5, '1', '投保渠道')
ON CONFLICT DO NOTHING;

-- ---- 产品 ----
INSERT INTO ins_product_main (product_id, product_name, product_type, product_status, insure_age_range, pay_year_list, insure_period, register_date) VALUES
('PRD001', '康宁终身重疾险', '01', '01', '28天-55周岁', '10年/20年/30年', '终身', '2023-03-01'),
('PRD002', '惠民百万医疗险', '02', '01', '30天-65周岁', '1年', '1年', '2023-05-01'),
('PRD003', '安心出行意外险', '03', '01', '18-65周岁', '1年', '1年', '2023-02-15'),
('PRD004', '金瑞定期寿险',   '04', '01', '18-60周岁', '10年/20年/30年', '至70周岁', '2023-06-01'),
('PRD005', '福享一生年金险', '05', '01', '30天-60周岁', '5年/10年', '终身', '2023-08-01'),
('PRD006', '居家家财险',     '06', '01', '18-70周岁', '1年', '1年', '2023-04-01')
ON CONFLICT DO NOTHING;

-- ---- 费率 ----
INSERT INTO ins_product_rate (rate_id, product_id, insure_age, gender, pay_year, sum_insure, year_pay) VALUES
('RATE001', 'PRD001', 30, '1', '20年', 500000, 5200.00),
('RATE002', 'PRD001', 35, '2', '20年', 500000, 5800.00),
('RATE003', 'PRD002', 30, '1', '1年',  300000, 1200.00),
('RATE004', 'PRD002', 40, '2', '1年',  300000, 1500.00),
('RATE005', 'PRD003', 30, '1', '1年',  100000, 800.00),
('RATE006', 'PRD004', 35, '1', '20年', 600000, 3200.00),
('RATE007', 'PRD005', 40, '2', '10年', 500000, 10000.00)
ON CONFLICT DO NOTHING;

-- ---- 客户 ----
INSERT INTO ins_customer (customer_id, customer_name, id_type, id_no, gender, birthday, phone, address, customer_status) VALUES
('CUS0001', '陈建国', '1', '110101198503121234', '1', '1985-03-12', '13800000001', '北京市朝阳区建国路88号', '0'),
('CUS0002', '刘美玲', '1', '310104199002214521', '2', '1990-02-21', '13800000002', '上海市浦东新区世纪大道100号', '0'),
('CUS0003', '王大力', '1', '110108197811052378', '1', '1978-11-05', '13800000003', '北京市海淀区中关村大街1号', '0'),
('CUS0004', '李秀英', '1', '310115196505093428', '2', '1965-05-09', '13800000004', '上海市浦东新区张江路50号', '0'),
('CUS0005', '赵子龙', '1', '110105199407162556', '1', '1994-07-16', '13800000005', '北京市朝阳区望京西路9号', '0'),
('CUS0006', '孙丽华', '1', '310101198812081547', '2', '1988-12-08', '13800000006', '上海市黄浦区南京东路200号', '0'),
('CUS0007', '周建军', '1', '110102196204151876', '1', '1962-04-15', '13800000007', '北京市西城区金融街35号', '0'),
('CUS0008', '吴桂芳', '1', '310106197011224563', '2', '1970-11-22', '13800000008', '上海市静安区南京西路1600号', '0')
ON CONFLICT DO NOTHING;

-- ---- 保单 ----
INSERT INTO ins_policy_main (policy_id, policy_no, product_id, product_type, product_name, policy_status, applicant_id, insured_id, apply_date, effect_date, end_date, year_premium, total_premium, total_amount, pay_type, pay_year, insure_period, org_code, channel_type, agent_id, underwrite_result, surrender_date) VALUES
('POL0001', 'P20240001', 'PRD001', '01', '康宁终身重疾险', '02', 'CUS0001', 'CUS0001', '2024-01-10', '2024-02-01', '2034-01-31', 5200.00,  52000.00, 500000.00, '1', 10, '终身',     'ORG0101',   '02', 'AGENT001', '01', NULL),
('POL0002', 'P20240002', 'PRD002', '02', '惠民百万医疗险', '02', 'CUS0002', 'CUS0002', '2024-03-05', '2024-04-01', '2025-03-31', 1800.00,  1800.00,  300000.00, '1', 1,  '1年',      'ORG010101', '03', NULL,      '01', NULL),
('POL0003', 'P20240003', 'PRD002', '02', '惠民百万医疗险', '02', 'CUS0003', 'CUS0003', '2024-05-12', '2024-06-01', '2025-05-31', 1200.00,  1200.00,  200000.00, '1', 1,  '1年',      'ORG0201',   '04', NULL,      '01', NULL),
('POL0004', 'P20240004', 'PRD003', '03', '安心出行意外险', '02', 'CUS0004', 'CUS0004', '2024-02-20', '2024-03-01', '2025-02-28', 800.00,   800.00,   100000.00, '1', 1,  '1年',      'ORG0101',   '05', NULL,      '01', NULL),
('POL0005', 'P20240005', 'PRD003', '03', '安心出行意外险', '04', 'CUS0005', 'CUS0005', '2023-11-01', '2023-12-01', '2024-11-30', 800.00,   800.00,   100000.00, '1', 1,  '1年',      'ORG020101', '01', NULL,      '01', '2024-05-15'),
('POL0006', 'P20240006', 'PRD004', '04', '金瑞定期寿险',   '02', 'CUS0006', 'CUS0006', '2024-04-15', '2024-05-01', '2034-04-30', 3200.00,  32000.00, 600000.00, '1', 10, '至70周岁', 'ORG0101',   '02', 'AGENT002', '01', NULL),
('POL0007', 'P20240007', 'PRD004', '04', '金瑞定期寿险',   '05', 'CUS0007', 'CUS0007', '2022-06-01', '2022-07-01', '2024-06-30', 2600.00,  26000.00, 400000.00, '1', 10, '至70周岁', 'ORG0201',   '01', NULL,      '01', '2024-06-30'),
('POL0008', 'P20240008', 'PRD005', '05', '福享一生年金险', '02', 'CUS0008', 'CUS0008', '2024-06-01', '2024-07-01', '2034-06-30', 10000.00, 100000.00, 500000.00, '1', 10, '终身',     'ORG0101',   '02', 'AGENT001', '04', NULL),
('POL0009', 'P20240009', 'PRD001', '01', '康宁终身重疾险', '01', 'CUS0002', 'CUS0002', '2025-06-20', NULL, NULL, 5200.00, 52000.00, 500000.00, '1', 20, '终身', 'ORG0101', '02', 'AGENT003', '02', NULL),
('POL0010', 'P20240010', 'PRD006', '06', '居家家财险',     '02', 'CUS0004', 'CUS0004', '2024-07-01', '2024-07-10', '2025-07-09', 1500.00,  1500.00,  800000.00, '1', 1,  '1年',      'ORG010101', '03', NULL,      '01', NULL),
('POL0011', 'P20240011', 'PRD002', '02', '惠民百万医疗险', '05', 'CUS0007', 'CUS0007', '2024-01-15', '2024-02-01', '2025-01-31', 1200.00,  1200.00,  200000.00, '1', 1,  '1年',      'ORG010101', '03', NULL,      '01', '2025-01-31')
ON CONFLICT DO NOTHING;

-- ---- 附加险 ----
INSERT INTO ins_policy_rider (rider_id, policy_id, rider_product_id, rider_product_name, rider_premium, rider_amount, rider_status, effect_date, end_date) VALUES
('RDR001', 'POL0001', 'PRD002', '惠民百万医疗险', 800.00, 100000.00, '01', '2024-02-01', '2034-01-31'),
('RDR002', 'POL0006', 'PRD003', '安心出行意外险', 300.00, 50000.00,  '01', '2024-05-01', '2034-04-30')
ON CONFLICT DO NOTHING;

-- ---- 缴费记录 ----
INSERT INTO ins_policy_pay_log (pay_log_id, policy_id, pay_period, should_pay_amount, actual_pay_amount, pay_deadline, pay_time, pay_status, pay_channel) VALUES
('PAY0001', 'POL0001', 1, 5200.00, 5200.00, '2024-02-01', '2024-01-28', '02', '银行卡代扣'),
('PAY0002', 'POL0001', 2, 5200.00, 0.00,    '2025-02-01', NULL,        '01', '银行卡代扣'),
('PAY0003', 'POL0002', 1, 1800.00, 1800.00, '2024-04-01', '2024-03-25', '02', '线上支付'),
('PAY0004', 'POL0006', 1, 3200.00, 3200.00, '2024-05-01', '2024-04-20', '02', '银行卡代扣'),
('PAY0005', 'POL0006', 2, 3200.00, 0.00,    '2025-05-01', NULL,        '03', '银行卡代扣'),
('PAY0006', 'POL0008', 1, 10000.00, 10000.00, '2024-07-01', '2024-06-25', '02', '线上支付')
ON CONFLICT DO NOTHING;

-- ---- 核保记录 ----
INSERT INTO ins_policy_underwrite (underwrite_id, policy_id, underwrite_user, underwrite_time, underwrite_type, underwrite_result, add_fee_rate, underwrite_opinion) VALUES
('UW0001', 'POL0001', 'U002', '2024-01-20 10:00:00', '01', '01', 0.00, '智能核保通过'),
('UW0002', 'POL0009', 'U002', '2025-06-25 14:30:00', '02', '02', 0.00, '客户存在高血压病史，核保拒保'),
('UW0003', 'POL0006', 'U002', '2024-04-22 09:15:00', '01', '01', 0.00, '智能核保通过'),
('UW0004', 'POL0008', 'U002', '2024-06-15 11:00:00', '01', '04', 5.00, '投保人年龄偏大，加费5%承保')
ON CONFLICT DO NOTHING;

-- ---- 受益人 ----
INSERT INTO ins_policy_benefit (benefit_id, policy_id, customer_id, relation_type, benefit_rate, benefit_level, benefit_status) VALUES
('BNF0001', 'POL0001', 'CUS0006', '01', 50.00, '1', '1'),
('BNF0002', 'POL0001', 'CUS0005', '03', 50.00, '2', '1'),
('BNF0003', 'POL0006', 'CUS0005', '01', 100.00, '1', '1')
ON CONFLICT DO NOTHING;

-- ---- 退保 ----
INSERT INTO ins_policy_surrender (surrender_id, policy_id, surrender_type, apply_time, audit_time, cash_value, surrender_amount, surrender_status, surrender_reason) VALUES
('SUR0001', 'POL0005', '01', '2024-05-10 10:00:00', '2024-05-14 15:00:00', 600.00, 600.00, '03', '个人资金安排变更')
ON CONFLICT DO NOTHING;

-- ---- 保全 ----
INSERT INTO ins_preserve_main (preserve_id, policy_id, preserve_type, preserve_status, apply_customer_id, apply_time, audit_time, audit_user_id, audit_opinion, change_desc, org_code) VALUES
('PRS0001', 'POL0001', '03', '04', 'CUS0001', '2024-04-10 09:00:00', '2024-04-12 16:00:00', 'U001', '审核通过', '受益人变更为子女', 'ORG0101'),
('PRS0002', 'POL0002', '01', '01', 'CUS0002', '2025-02-01 10:30:00', NULL, NULL, NULL, '联系电话变更', 'ORG010101'),
('PRS0003', 'POL0004', '05', '02', 'CUS0004', '2024-10-20 14:00:00', '2024-10-21 11:00:00', 'U001', '同意复效', '保单复效', 'ORG0101'),
('PRS0004', 'POL0006', '02', '04', 'CUS0006', '2024-07-15 09:30:00', '2024-07-16 17:00:00', 'U001', '审核通过', '缴费方式由年交改为月交', 'ORG0101'),
('PRS0005', 'POL0003', '07', '05', 'CUS0003', '2024-12-01 15:00:00', '2024-12-02 10:00:00', 'U001', '客户主动撤销', '申请退保后撤销', 'ORG0201')
ON CONFLICT DO NOTHING;

-- ---- 保全明细 ----
INSERT INTO ins_preserve_detail (detail_id, preserve_id, field_name, field_desc, old_value, new_value, change_time) VALUES
('DTL0001', 'PRS0001', 'benefit', '受益人', 'CUS0006', 'CUS0005', '2024-04-12 16:00:00'),
('DTL0002', 'PRS0002', 'phone', '联系电话', '13800000002', '13900000002', '2025-02-01 10:30:00'),
('DTL0003', 'PRS0004', 'pay_type', '缴费方式', '年交', '月交', '2024-07-16 17:00:00')
ON CONFLICT DO NOTHING;

-- ---- 保全费用变更 ----
INSERT INTO ins_preserve_fee (fee_id, preserve_id, old_premium, new_premium, old_amount, new_amount, adjust_fee, fee_status) VALUES
('FEE0001', 'PRS0004', 3200.00, 3000.00, 600000.00, 600000.00, -200.00, '2')
ON CONFLICT DO NOTHING;

-- ---- 保全受益人变更 ----
INSERT INTO ins_preserve_benefit (benefit_preserve_id, preserve_id, old_benefit_id, new_customer_id, new_relation, new_rate, change_effect_time) VALUES
('BPB0001', 'PRS0001', 'BNF0001', 'CUS0005', '03', 50.00, '2024-04-12 16:00:00')
ON CONFLICT DO NOTHING;

-- ---- 保全状态变更 ----
INSERT INTO ins_preserve_status (status_id, preserve_id, old_policy_status, new_policy_status, status_change_reason, effect_time) VALUES
('PST0001', 'PRS0003', '03', '02', '客户补缴保费后复效', '2024-10-21 11:00:00')
ON CONFLICT DO NOTHING;

-- ---- 理赔 ----
INSERT INTO ins_claim_main (claim_id, policy_id, claim_type, claim_status, insured_id, accident_time, report_time, accident_area, apply_claim_amount, actual_claim_amount, close_time, claim_reason, org_code) VALUES
('CLM0001', 'POL0001', '重疾理赔', '05', 'CUS0001', '2024-08-10 08:00:00', '2024-08-12 09:00:00', '北京市朝阳区', 200000.00, 200000.00, '2024-09-01 10:00:00', '确诊恶性肿瘤', 'ORG0101'),
('CLM0002', 'POL0002', '医疗理赔', '05', 'CUS0002', '2024-06-20 10:00:00', '2024-06-22 14:00:00', '上海市浦东新区', 8000.00, 6500.00, '2024-07-05 09:00:00', '住院医疗费用', 'ORG010101'),
('CLM0003', 'POL0003', '医疗理赔', '03', 'CUS0003', '2025-01-05 09:30:00', '2025-01-07 11:00:00', '上海市静安区', 12000.00, 0.00, NULL, '门诊手术费用', 'ORG0201'),
('CLM0004', 'POL0004', '意外理赔', '05', 'CUS0004', '2024-09-15 12:00:00', '2024-09-16 10:00:00', '北京市朝阳区', 5000.00, 5000.00, '2024-09-30 15:00:00', '意外骨折门诊', 'ORG0101'),
('CLM0005', 'POL0006', '身故理赔', '01', 'CUS0006', '2025-03-10 06:00:00', '2025-03-12 09:00:00', '上海市黄浦区', 600000.00, 0.00, NULL, '被保人身故', 'ORG0101'),
('CLM0006', 'POL0001', '重疾理赔', '04', 'CUS0001', '2025-05-01 07:00:00', '2025-05-03 10:00:00', '北京市朝阳区', 300000.00, 150000.00, NULL, '复发住院治疗', 'ORG0101')
ON CONFLICT DO NOTHING;

-- ---- 理赔赔付明细 ----
INSERT INTO ins_claim_pay (pay_id, claim_id, pay_amount, pay_time, pay_status, pay_channel, pay_order_no) VALUES
('CPY0001', 'CLM0001', 200000.00, '2024-08-30 16:00:00', '1', '银行卡', 'PAYORD001'),
('CPY0002', 'CLM0002', 6500.00, '2024-07-01 10:00:00', '1', '银行卡', 'PAYORD002'),
('CPY0003', 'CLM0004', 5000.00, '2024-09-25 14:00:00', '1', '银行卡', 'PAYORD003'),
('CPY0004', 'CLM0006', 150000.00, '2025-05-20 11:00:00', '1', '银行卡', 'PAYORD004')
ON CONFLICT DO NOTHING;

-- ---- 理赔审核 ----
INSERT INTO ins_claim_audit (audit_id, claim_id, audit_stage, audit_user_id, audit_result, audit_opinion, audit_time) VALUES
('AUD0001', 'CLM0001', '立案审核', 'U003', '01', '材料齐全，准予立案', '2024-08-13 09:00:00'),
('AUD0002', 'CLM0001', '终审',     'U003', '01', '核赔通过，按保额赔付', '2024-08-29 15:00:00'),
('AUD0003', 'CLM0003', '立案审核', 'U003', '01', '准予立案', '2025-01-08 09:30:00'),
('AUD0004', 'CLM0003', '赔付复核', 'U003', '03', '补充诊断证明', '2025-01-15 10:00:00'),
('AUD0005', 'CLM0005', '立案审核', 'U003', '01', '准予立案，转查勘', '2025-03-13 09:00:00')
ON CONFLICT DO NOTHING;

-- 补充字典：保全状态 / 核保结果 / 缴费方式
INSERT INTO sys_dict (dict_id, dict_type, dict_label, dict_value, sort_num, status, remark) VALUES
('DICT-PVS-01', 'preserve_status',  '待审核', '01', 1, '1', '保全状态'),
('DICT-PVS-02', 'preserve_status',  '审核通过', '02', 2, '1', '保全状态'),
('DICT-PVS-03', 'preserve_status',  '审核驳回', '03', 3, '1', '保全状态'),
('DICT-PVS-04', 'preserve_status',  '已办结', '04', 4, '1', '保全状态'),
('DICT-PVS-05', 'preserve_status',  '已撤销', '05', 5, '1', '保全状态'),
('DICT-UW-01',  'underwrite_result','通过', '01', 1, '1', '核保结果'),
('DICT-UW-02',  'underwrite_result','拒保', '02', 2, '1', '核保结果'),
('DICT-UW-03',  'underwrite_result','延期', '03', 3, '1', '核保结果'),
('DICT-UW-04',  'underwrite_result','加费承保', '04', 4, '1', '核保结果')
ON CONFLICT DO NOTHING;

-- 补充字典：理赔类型 / 缴费方式（传统查询下拉联动；理赔表 claim_type 直接存中文标签，故 dict_value 与标签一致）
INSERT INTO sys_dict (dict_id, dict_type, dict_label, dict_value, sort_num, status, remark) VALUES
('DICT-CT-01', 'claim_type', '医疗理赔', '医疗理赔', 1, '1', '理赔类型'),
('DICT-CT-02', 'claim_type', '重疾理赔', '重疾理赔', 2, '1', '理赔类型'),
('DICT-CT-03', 'claim_type', '意外理赔', '意外理赔', 3, '1', '理赔类型'),
('DICT-CT-04', 'claim_type', '身故理赔', '身故理赔', 4, '1', '理赔类型'),
('DICT-CT-05', 'claim_type', '伤残理赔', '伤残理赔', 5, '1', '理赔类型'),
('DICT-CT-06', 'claim_type', '财产理赔', '财产理赔', 6, '1', '理赔类型'),
('DICT-PY-01', 'pay_type', '年交', '1', 1, '1', '缴费方式'),
('DICT-PY-02', 'pay_type', '月交', '2', 2, '1', '缴费方式'),
('DICT-PY-03', 'pay_type', '趸交', '3', 3, '1', '缴费方式'),
('DICT-PY-04', 'pay_type', '季交', '4', 4, '1', '缴费方式')
ON CONFLICT DO NOTHING;

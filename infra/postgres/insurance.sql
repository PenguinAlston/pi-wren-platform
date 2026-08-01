-- 保险行业 demo 数据：保单 / 理赔 / 收付费
CREATE TABLE IF NOT EXISTS insurance_policy (
    policy_no      VARCHAR(20) PRIMARY KEY,
    customer_id    VARCHAR(20) NOT NULL,
    product_code   VARCHAR(20) NOT NULL,
    product_name   VARCHAR(100) NOT NULL,
    premium        NUMERIC NOT NULL,
    coverage_amount NUMERIC NOT NULL,
    status         VARCHAR(20) NOT NULL,
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS insurance_claim (
    claim_no      VARCHAR(20) PRIMARY KEY,
    policy_no     VARCHAR(20) NOT NULL REFERENCES insurance_policy(policy_no),
    claim_amount  NUMERIC NOT NULL,
    paid_amount   NUMERIC NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL,
    report_date   DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS insurance_payment (
    payment_no  VARCHAR(20) PRIMARY KEY,
    policy_no   VARCHAR(20) NOT NULL REFERENCES insurance_policy(policy_no),
    premium     NUMERIC NOT NULL,
    paid_date   DATE NOT NULL
);

INSERT INTO insurance_policy (policy_no, customer_id, product_code, product_name, premium, coverage_amount, status, start_date, end_date) VALUES
('P20240001', 'C0001', 'AUTO',    '车险',      3600,  200000, '有效', '2024-01-05', '2025-01-04'),
('P20240002', 'C0002', 'AUTO',    '车险',      4200,  200000, '有效', '2024-02-11', '2025-02-10'),
('P20240003', 'C0003', 'AUTO',    '车险',      2800,  150000, '终止', '2023-06-01', '2024-05-31'),
('P20240004', 'C0004', 'MED',     '医疗险',    1200,  300000, '有效', '2024-01-20', '2025-01-19'),
('P20240005', 'C0005', 'MED',     '医疗险',    1800,  500000, '有效', '2024-03-08', '2025-03-07'),
('P20240006', 'C0006', 'MED',     '医疗险',    1500,  400000, '满期', '2022-12-01', '2023-11-30'),
('P20240007', 'C0007', 'CI',      '重疾险',    5200,  500000, '有效', '2024-01-15', '2034-01-14'),
('P20240008', 'C0008', 'CI',      '重疾险',    6800,  800000, '有效', '2024-04-02', '2034-04-01'),
('P20240009', 'C0009', 'LIFE',    '寿险',      3200,  600000, '有效', '2024-02-28', '2034-02-27'),
('P20240010', 'C0010', 'LIFE',    '寿险',      2600,  400000, '终止', '2023-05-01', '2024-04-30')
ON CONFLICT DO NOTHING;

INSERT INTO insurance_claim (claim_no, policy_no, claim_amount, paid_amount, status, report_date) VALUES
('CL2024001', 'P20240001', 8000,  8000,  '已赔付', '2024-03-12'),
('CL2024002', 'P20240001', 15000, 15000, '已赔付', '2024-07-20'),
('CL2024003', 'P20240002', 5000,  5000,  '已赔付', '2024-05-06'),
('CL2024004', 'P20240004', 3000,  3000,  '已赔付', '2024-04-18'),
('CL2024005', 'P20240005', 12000, 0,     '审核中', '2024-08-02'),
('CL2024006', 'P20240005', 6000,  6000,  '已赔付', '2024-06-25'),
('CL2024007', 'P20240007', 200000, 200000, '已赔付', '2024-09-10'),
('CL2024008', 'P20240008', 300000, 0,     '已立案', '2024-10-15')
ON CONFLICT DO NOTHING;

INSERT INTO insurance_payment (payment_no, policy_no, premium, paid_date) VALUES
('PAY2024001', 'P20240001', 3600, '2024-01-05'),
('PAY2024002', 'P20240002', 4200, '2024-02-11'),
('PAY2024003', 'P20240004', 1200, '2024-01-20'),
('PAY2024004', 'P20240005', 1800, '2024-03-08'),
('PAY2024005', 'P20240007', 5200, '2024-01-15'),
('PAY2024006', 'P20240008', 6800, '2024-04-02'),
('PAY2024007', 'P20240009', 3200, '2024-02-28')
ON CONFLICT DO NOTHING;

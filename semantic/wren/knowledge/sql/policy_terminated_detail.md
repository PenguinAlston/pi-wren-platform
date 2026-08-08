---
nl: 已终止保单明细（状态=已终止，可按年份筛选终止日期；返回保单号与被保人姓名）
sql: |-
  SELECT p.policy_no,
         c.customer_name AS insured_name,
         p.product_name,
         p.end_date,
         p.surrender_date
  FROM ins_policy_main p
  LEFT JOIN ins_customer c ON c.customer_id = p.insured_id
  WHERE p.policy_status = '05'
    AND 1=1
  ORDER BY p.end_date;
source: seed
datasource: insurance-postgres
---

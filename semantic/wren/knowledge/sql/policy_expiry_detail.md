---
nl: 到期/终止保单明细（按终止日期筛选年份；同时标注已终止/到期两种口径，返回保单号与被保人姓名）
sql: >-
  SELECT p.policy_no,
         c.customer_name AS insured_name,
         p.product_name,
         p.end_date,
         d.dict_label AS policy_status,
         CASE WHEN p.policy_status = '05' THEN '已终止' ELSE '到期' END AS term_type
  FROM ins_policy_main p

  LEFT JOIN ins_customer c ON c.customer_id = p.insured_id

  LEFT JOIN sys_dict d ON d.dict_type = 'policy_status' AND d.dict_value =
  p.policy_status

  WHERE 1=1
    AND p.end_date IS NOT NULL
  ORDER BY term_type, p.end_date;
source: seed
datasource: insurance-postgres
---

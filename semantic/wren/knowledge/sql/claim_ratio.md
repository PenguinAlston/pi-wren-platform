---
nl: 赔付率分析（按险种汇总）
sql: >-
  SELECT d.dict_label AS product_type,
         COUNT(c.claim_id) AS claim_count,
         SUM(c.apply_claim_amount) AS apply_amount,
         SUM(c.actual_claim_amount) AS actual_amount
  FROM ins_claim_main c

  JOIN ins_policy_main p ON p.policy_id = c.policy_id

  LEFT JOIN sys_dict d ON d.dict_type = 'product_type' AND d.dict_value =
  p.product_type

  GROUP BY d.dict_label

  ORDER BY actual_amount DESC;
source: seed
datasource: insurance-postgres
---

---
nl: 默认综合总览（按险种）
sql: >-
  SELECT d.dict_label AS product_type,
         COUNT(DISTINCT p.policy_id) AS policy_count,
         SUM(p.year_premium) AS total_premium,
         COUNT(DISTINCT c.claim_id) AS claim_count
  FROM ins_policy_main p

  LEFT JOIN ins_claim_main c ON c.policy_id = p.policy_id

  LEFT JOIN sys_dict d ON d.dict_type = 'product_type' AND d.dict_value =
  p.product_type

  GROUP BY d.dict_label

  ORDER BY total_premium DESC;
source: seed
datasource: insurance-postgres
---

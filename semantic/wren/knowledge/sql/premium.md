---
nl: 保费规模（按险种）
sql: >-
  SELECT d.dict_label AS product_type, COUNT(*) AS policy_count,
  SUM(p.year_premium) AS total_premium

  FROM ins_policy_main p

  LEFT JOIN sys_dict d ON d.dict_type = 'product_type' AND d.dict_value =
  p.product_type

  GROUP BY d.dict_label

  ORDER BY total_premium DESC;
source: seed
datasource: insurance-postgres
---

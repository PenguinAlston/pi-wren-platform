---
nl: 件均保费（按险种）
sql: >-
  SELECT d.dict_label AS product_type, COUNT(*) AS policy_count,
  AVG(p.year_premium) AS avg_premium

  FROM ins_policy_main p

  LEFT JOIN sys_dict d ON d.dict_type = 'product_type' AND d.dict_value =
  p.product_type

  GROUP BY d.dict_label

  ORDER BY avg_premium DESC;
source: seed
datasource: insurance-postgres
---

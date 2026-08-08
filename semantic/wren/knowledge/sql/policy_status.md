---
nl: 保单状态分布
sql: >-
  SELECT d.dict_label AS policy_status, COUNT(*) AS policy_count

  FROM ins_policy_main p

  LEFT JOIN sys_dict d ON d.dict_type = 'policy_status' AND d.dict_value =
  p.policy_status

  GROUP BY d.dict_label

  ORDER BY policy_count DESC;
source: seed
datasource: insurance-postgres
---

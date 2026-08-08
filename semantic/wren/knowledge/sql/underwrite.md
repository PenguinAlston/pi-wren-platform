---
nl: 核保结果统计
sql: >-
  SELECT d.dict_label AS underwrite_result, COUNT(*) AS underwrite_count

  FROM ins_policy_underwrite u

  LEFT JOIN sys_dict d ON d.dict_type = 'underwrite_result' AND d.dict_value =
  u.underwrite_result

  GROUP BY d.dict_label

  ORDER BY underwrite_count DESC;
source: seed
datasource: insurance-postgres
---

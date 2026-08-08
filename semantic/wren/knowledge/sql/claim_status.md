---
nl: 理赔状态分布
sql: >-
  SELECT d.dict_label AS claim_status, COUNT(*) AS claim_count

  FROM ins_claim_main c

  LEFT JOIN sys_dict d ON d.dict_type = 'claim_status' AND d.dict_value =
  c.claim_status

  GROUP BY d.dict_label

  ORDER BY claim_count DESC;
source: seed
datasource: insurance-postgres
---

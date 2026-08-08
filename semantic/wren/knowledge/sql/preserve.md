---
nl: 保全业务统计（按类型与状态）
sql: >-
  SELECT dt.dict_label AS preserve_type, ds.dict_label AS preserve_status,
  COUNT(*) AS preserve_count

  FROM ins_preserve_main m

  LEFT JOIN sys_dict dt ON dt.dict_type = 'preserve_type' AND dt.dict_value =
  m.preserve_type

  LEFT JOIN sys_dict ds ON ds.dict_type = 'preserve_status' AND ds.dict_value =
  m.preserve_status

  GROUP BY dt.dict_label, ds.dict_label

  ORDER BY preserve_count DESC;
source: seed
datasource: insurance-postgres
---

import type { SemanticConfig } from '@pi-wren/context-engine';

const DANGEROUS_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|execute|call|merge|replace|do|comment)\b/i;

/**
 * 解析并校验 LLM 生成的 SQL：
 * - 剥离 Markdown 代码块
 * - 仅允许只读 SELECT/WITH
 * - 禁止高危/删改语句与多语句注入
 * - 表名必须在语义配置声明的模型（或 sys_dict 字典表）范围内
 */
export function parseAndValidateSql(
  raw: string,
  config: SemanticConfig,
  maxLength = 2000,
): string {
  let sql = raw.trim();

  const fence = sql.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence) {
    sql = fence[1]?.trim() ?? '';
  }

  sql = sql.replace(/;\s*$/, '').trim();

  if (!sql) {
    throw new Error('LLM 返回了空 SQL');
  }
  if (sql.length > maxLength) {
    throw new Error(`LLM 生成的 SQL 过长（${sql.length} > ${maxLength}）`);
  }
  if (DANGEROUS_KEYWORDS.test(sql)) {
    throw new Error('检测到疑似高危/删改语句，已拦截');
  }
  if (!/^(select|with)\b/i.test(sql)) {
    throw new Error('仅允许 SELECT/WITH 只读查询');
  }
  if (sql.includes(';')) {
    throw new Error('不允许执行多条语句');
  }

  const normalized = sql.replace(/"/g, '');
  const allowed = new Set(
    [...config.models.map((m) => m.table), 'sys_dict'].map((t) => t.toLowerCase()),
  );
  // CTE 名称放行（WITH x AS (...) 中的 x 不是物理表）
  for (const match of normalized.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\b/gi)) {
    allowed.add((match[1] ?? '').toLowerCase());
  }

  const refs = [
    ...normalized.matchAll(/\bfrom\s+([a-z_][a-z0-9_.]*)/gi),
    ...normalized.matchAll(/\bjoin\s+([a-z_][a-z0-9_.]*)/gi),
  ]
    .map((match) => (match[1] ?? '').split('.').pop()?.toLowerCase() ?? '')
    .filter(Boolean);

  for (const table of refs) {
    if (!allowed.has(table)) {
      throw new Error(`LLM 引用了未声明表：${table}`);
    }
  }

  return sql;
}

import type { SemanticConfig } from '@pi-wren/context-engine';

const DANGEROUS_KEYWORDS =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|execute|call|merge|replace|do|comment)\b/i;

/** 危险/高权限 PostgreSQL 函数（DoS、服务端文件访问、后端控制等），一律拦截。 */
const DANGEROUS_FUNCTIONS =
  /\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_write_file|pg_terminate_backend|pg_cancel_backend|pg_advisory_lock|pg_advisory_xact_lock|pg_try_advisory_lock|pg_reload_conf|pg_rotate_logfile|pg_log_backend_memory_contexts|lo_import|lo_export|dblink_connect|dblink_exec|pg_get_functiondef)\b/i;

/**
 * 将字符串字面量（含 $$ 美元引用）替换为占位符、剥离 SQL 注释，
 * 使关键字/函数/表名检查不受字符串内容与注释干扰（防绕过 + 防误报）。
 */
export function normalizeForInspection(sql: string): string {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, (m) => "'x'".repeat(Math.max(1, Math.ceil(m.length / 3))))
    .replace(/'([^']|'')*'/g, (m) => "'x'".repeat(Math.max(1, Math.ceil(m.length / 3))))
    // 块注释替换为空串：PostgreSQL 词法允许单词跨 /* */ 连接（DEL/**/ETE == DELETE）
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * 解析并校验 SQL（所有执行路径的统一关口）：
 * - 剥离 Markdown 代码块
 * - 仅允许只读 SELECT/WITH
 * - 禁止高危/删改语句、危险函数、多语句注入（含注释/字符串内绕过）
 * - 表名必须在语义配置声明的模型（或 sys_dict 字典表）范围内；config 缺失时跳过表名检查
 */
export function parseAndValidateSql(
  raw: string,
  config?: SemanticConfig,
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

  // 检查前先做字符串占位 + 注释剥离，防止 DEL/**/ETE、字符串内关键字等绕过
  const normalized = normalizeForInspection(sql);

  if (DANGEROUS_FUNCTIONS.test(normalized)) {
    throw new Error('检测到危险函数调用，已拦截');
  }
  if (DANGEROUS_KEYWORDS.test(normalized)) {
    throw new Error('检测到疑似高危/删改语句，已拦截');
  }
  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error('仅允许 SELECT/WITH 只读查询');
  }
  if (normalized.includes(';')) {
    throw new Error('不允许执行多条语句');
  }

  if (!config) {
    // 无语义配置（如 Wren 路径）时跳过表名白名单，其余检查保留
    return sql;
  }

  const clean = normalized.replace(/"/g, '');
  const allowed = new Set(
    [...config.models.map((m) => m.table), 'sys_dict'].map((t) => t.toLowerCase()),
  );
  // CTE 名称放行（WITH x AS (...) 中的 x 不是物理表）
  for (const match of clean.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\b/gi)) {
    allowed.add((match[1] ?? '').toLowerCase());
  }

  const refs = [
    ...clean.matchAll(/\bfrom\s+([a-z_][a-z0-9_.]*)/gi),
    ...clean.matchAll(/\bjoin\s+([a-z_][a-z0-9_.]*)/gi),
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

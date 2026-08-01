import { executeSQL } from '../../../data-engine/src/sql-runner';

export async function executeDatabaseQuery(sql: string) {
  return executeSQL(sql);
}

import { pool } from './postgres-client';

export async function executeSQL(sql: string) {
  const result = await pool.query(sql);

  return {
    rows: result.rows,
    count: result.rowCount,
  };
}

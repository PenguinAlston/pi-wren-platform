import { generateSQL } from './tools/wren-sql-tool';
import { executeDatabaseQuery } from './tools/database-tool';
import { analyzeQueryResult } from './tools/result-analysis-tool';

export interface DataAgentResponse {
  answer: string;
  sql: string;
  data: unknown[];
  trace: string[];
}

export async function runDataAgent(
  question: string,
): Promise<DataAgentResponse> {
  const trace: string[] = [];

  trace.push('received user question');

  const sqlResult = await generateSQL(question);

  trace.push('generated SQL through WrenAI');

  const sql = sqlResult.sql || sqlResult.query || '';

  if (!sql) {
    return {
      answer: 'No SQL generated',
      sql: '',
      data: [],
      trace,
    };
  }

  const databaseResult = await executeDatabaseQuery(sql);

  trace.push('executed SQL on PostgreSQL');

  const analysis = analyzeQueryResult(databaseResult.rows);

  trace.push('created business analysis');

  return {
    answer: JSON.stringify(analysis),
    sql,
    data: databaseResult.rows,
    trace,
  };
}

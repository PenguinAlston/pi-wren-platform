import { generateSQL } from '../tools/wren-sql-tool';
import { executeDatabaseQuery } from '../tools/database-tool';
import { analyzeQueryResult } from '../tools/result-analysis-tool';

export interface FinanceAgentResult {
  answer: string;
  sql?: string;
  data?: unknown;
  trace: string[];
}

export async function runFinanceAgent(
  question: string,
): Promise<FinanceAgentResult> {
  const trace: string[] = [];

  trace.push('Understanding business question');

  const sqlResponse = await generateSQL(question);

  trace.push('Generating SQL with WrenAI');

  const sql = sqlResponse.sql || sqlResponse.query || '';

  if (!sql) {
    return {
      answer: 'Unable to generate SQL',
      trace,
    };
  }

  const result = await executeDatabaseQuery(sql);

  trace.push('Executing PostgreSQL query');

  const analysis = analyzeQueryResult(result.rows);

  trace.push('Generating business summary');

  return {
    answer: JSON.stringify(analysis),
    sql,
    data: result.rows,
    trace,
  };
}

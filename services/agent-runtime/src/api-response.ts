import { DataAgentResponse } from './data-agent';

export function formatAgentResponse(result: DataAgentResponse) {
  return {
    answer: result.answer,
    sql: result.sql,
    data: result.data,
    trace: result.trace,
  };
}

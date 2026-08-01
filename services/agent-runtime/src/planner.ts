export interface PlanStep {
  id: string;
  action: string;
  description: string;
}

export type PlanKind = 'finance_analysis' | 'general';

/** Produces the execution plan for a question. */
export class AgentPlanner {
  createPlan(input: string, kind: PlanKind = 'finance_analysis'): PlanStep[] {
    if (kind === 'general') {
      return [
        { id: 'understand', action: 'analyze_request', description: `Understand request: ${input}` },
        { id: 'answer', action: 'generate_answer', description: 'Generate final response' },
      ];
    }

    return [
      { id: 'understand', action: 'analyze_request', description: `Understand business question: ${input}` },
      { id: 'sql', action: 'generate_sql', description: 'Generate SQL through the semantic layer' },
      { id: 'execute', action: 'execute_query', description: 'Execute query against the data engine' },
      { id: 'analyze', action: 'analyze_result', description: 'Analyze query results' },
      { id: 'answer', action: 'generate_answer', description: 'Produce an executive summary' },
    ];
  }
}

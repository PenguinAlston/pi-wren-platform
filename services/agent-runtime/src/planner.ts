export interface PlanStep {
  id: string;
  action: string;
  description: string;
}

export class AgentPlanner {
  createPlan(input: string): PlanStep[] {
    return [
      {
        id: 'understand',
        action: 'analyze_request',
        description: `Understand user request: ${input}`,
      },
      {
        id: 'context',
        action: 'retrieve_context',
        description: 'Retrieve enterprise context from Wren',
      },
      {
        id: 'answer',
        action: 'generate_answer',
        description: 'Generate final response',
      },
    ];
  }
}

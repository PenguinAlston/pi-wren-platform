export interface ToolDecision {
  tool?: string;
  reason: string;
}

export class ToolSelector {
  decide(input: string): ToolDecision {
    const text = input.toLowerCase();

    if (text.includes('利润') || text.includes('profit')) {
      return {
        tool: 'wren_search_knowledge',
        reason: 'Business metric analysis requires Wren context',
      };
    }

    return {
      reason: 'No external tool required',
    };
  }
}

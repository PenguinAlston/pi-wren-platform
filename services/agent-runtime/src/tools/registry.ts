export interface AgentToolContext {
  question: string;
}

export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  execute(input: I, context: AgentToolContext): Promise<O>;
}

export interface AgentToolSummary {
  name: string;
  description: string;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentToolSummary[] {
    return [...this.tools.values()].map(({ name, description }) => ({ name, description }));
  }

  async execute(name: string, input: unknown, context: AgentToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool.execute(input, context);
  }
}

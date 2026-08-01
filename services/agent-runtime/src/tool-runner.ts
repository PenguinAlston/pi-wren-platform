export interface RuntimeTool {
  name: string;
  description: string;
  execute(input: unknown): Promise<unknown>;
}

export class ToolRunner {
  private tools = new Map<string, RuntimeTool>();

  register(tool: RuntimeTool) {
    this.tools.set(tool.name, tool);
  }

  async execute(name: string, input: unknown) {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool.execute(input);
  }

  list() {
    return [...this.tools.keys()];
  }
}

import { AgentLoop } from './loop';
import { ToolRunner } from './tool-runner';

export class EnterpriseAgent {
  private loop = new AgentLoop();
  private tools = new ToolRunner();

  registerTool(tool: any) {
    this.tools.register(tool);
  }

  async run(input: string) {
    return this.loop.run(input);
  }
}

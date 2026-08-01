import { AgentPlanner } from './planner';
import { AgentMemory } from './memory';
import { createEvent, RuntimeEvent } from './events';

export class AgentLoop {
  private planner = new AgentPlanner();
  private memory = new AgentMemory();

  async run(input: string): Promise<RuntimeEvent[]> {
    const events: RuntimeEvent[] = [];

    const plan = this.planner.createPlan(input);

    events.push(createEvent('plan', plan));

    this.memory.save('last_request', input);

    events.push(
      createEvent('observation', {
        context: 'Wren context lookup pending',
      }),
    );

    events.push(
      createEvent('answer', {
        content: `Processed request: ${input}`,
      }),
    );

    return events;
  }
}

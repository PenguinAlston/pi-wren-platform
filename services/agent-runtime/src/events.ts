import type { AgentEvent, AgentEventType } from '@pi-wren/shared-types';
import { randomUUID } from 'node:crypto';

export function createEvent(type: AgentEventType, label: string, detail?: string): AgentEvent {
  return {
    id: randomUUID(),
    type,
    label,
    ...(detail !== undefined ? { detail } : {}),
    timestamp: new Date().toISOString(),
  };
}

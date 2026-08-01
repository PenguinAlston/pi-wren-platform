export interface MemoryRecord {
  key: string;
  value: unknown;
  createdAt: string;
}

export class AgentMemory {
  private records: MemoryRecord[] = [];

  save(key: string, value: unknown) {
    this.records.push({
      key,
      value,
      createdAt: new Date().toISOString(),
    });
  }

  getAll() {
    return this.records;
  }
}

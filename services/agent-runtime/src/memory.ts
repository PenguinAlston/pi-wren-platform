export interface ConversationRecord {
  sessionId: string;
  question: string;
  answer: string;
  sql?: string;
  data?: unknown[];
  createdAt: string;
}

export interface MemoryStore {
  save(record: ConversationRecord): Promise<void>;
  list(): Promise<ConversationRecord[]>;
  get(sessionId: string): Promise<ConversationRecord | undefined>;
}

/** In-memory store; swap for Redis/Postgres persistence in production. */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, ConversationRecord>();

  async save(record: ConversationRecord): Promise<void> {
    this.records.set(record.sessionId, record);
  }

  async list(): Promise<ConversationRecord[]> {
    return [...this.records.values()];
  }

  async get(sessionId: string): Promise<ConversationRecord | undefined> {
    return this.records.get(sessionId);
  }
}

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
  /** 可选：返回某会话的全部历史记录（按时间正序），用于多轮记忆注入。 */
  getHistory?(sessionId: string): Promise<ConversationRecord[]>;
}

/** 进程内多轮会话存储；生产环境可替换为基于开源 Pi 的 PiSessionStore（jsonl 持久化）。 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, ConversationRecord[]>();

  async save(record: ConversationRecord): Promise<void> {
    const history = this.records.get(record.sessionId) ?? [];
    history.push(record);
    this.records.set(record.sessionId, history);
  }

  async list(): Promise<ConversationRecord[]> {
    return [...this.records.values()].flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async get(sessionId: string): Promise<ConversationRecord | undefined> {
    const history = this.records.get(sessionId);
    return history?.[history.length - 1];
  }

  async getHistory(sessionId: string): Promise<ConversationRecord[]> {
    return this.records.get(sessionId) ?? [];
  }
}

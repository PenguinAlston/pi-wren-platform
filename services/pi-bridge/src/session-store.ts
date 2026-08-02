import { JsonlSessionRepo, NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { Session } from '@earendil-works/pi-agent-core';
import type { ConversationRecord, MemoryStore } from '@pi-wren/agent-runtime';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** pi session 中存放一条问答记录的 custom entry 类型。 */
export const RECORD_ENTRY_TYPE = 'conversation_record';

/** sessionId 白名单：仅字母/数字/下划线/连字符，杜绝路径穿越。 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export interface PiSessionStoreOptions {
  /** 会话文件根目录，默认 <cwd>/data/sessions。 */
  sessionsRoot?: string;
  /** 会话归属工作目录，决定 jsonl 文件落盘的 cwd 子目录，默认进程 cwd。 */
  cwd?: string;
}

/**
 * 基于开源 Pi（@earendil-works/pi-agent-core）jsonl 会话仓库的 MemoryStore 实现。
 *
 * 每条问答记录以 custom entry 追加到对应 session 文件（jsonl），天然支持：
 * - 多轮续聊：同一 sessionId 追加多轮，`getHistory()` 按时间正序读取
 * - 会话树/分支：pi 的 Session 自带 id/parentId 树结构，未来可 fork
 * - 上下文压缩：entry 结构与 pi compaction 工具兼容
 *
 * 问答流水线本身保持确定性（方案 A），此处仅接入「会话持久化 + 事件协议」。
 */
export class PiSessionStore implements MemoryStore {
  private readonly env: NodeExecutionEnv;
  private readonly repo: JsonlSessionRepo;
  private readonly cwd: string;
  private readonly sessionsRoot: string;
  /** 同会话写队列：串行化 append，避免并发写同一 jsonl 文件损坏。 */
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(options: PiSessionStoreOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.sessionsRoot = options.sessionsRoot ?? join(this.cwd, 'data', 'sessions');
    mkdirSync(this.sessionsRoot, { recursive: true });
    this.env = new NodeExecutionEnv({ cwd: this.cwd });
    this.repo = new JsonlSessionRepo({ fs: this.env, sessionsRoot: this.sessionsRoot });
  }

  async save(record: ConversationRecord): Promise<void> {
    if (!isValidSessionId(record.sessionId)) {
      throw new Error(`invalid sessionId: ${record.sessionId}`);
    }
    const previous = this.writeQueues.get(record.sessionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const session = await this.openOrCreateSession(record.sessionId);
      await session.appendCustomEntry(RECORD_ENTRY_TYPE, record);
    });
    // 队列中失败不影响后续写入；错误向上传播给本次调用
    this.writeQueues.set(
      record.sessionId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    await next;
  }

  /** 返回某会话最新一条记录（兼容 MemoryStore 语义）。 */
  async get(sessionId: string): Promise<ConversationRecord | undefined> {
    const history = await this.getHistory(sessionId);
    return history[history.length - 1];
  }

  /** 全部会话的记录，按创建时间倒序。 */
  async list(): Promise<ConversationRecord[]> {
    const records: ConversationRecord[] = [];
    for (const meta of await this.repo.list()) {
      const session = await this.repo.open(meta);
      records.push(...(await this.readRecords(session)));
    }
    return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** 某会话全部历史记录（按时间正序），供多轮记忆注入。 */
  async getHistory(sessionId: string): Promise<ConversationRecord[]> {
    if (!isValidSessionId(sessionId)) {
      return [];
    }
    const session = await this.tryOpenSession(sessionId);
    return session ? this.readRecords(session) : [];
  }

  /** 会话统计（记录数 + 估算 token），供压缩决策使用。 */
  async getStats(sessionId: string): Promise<{ recordCount: number; estimatedTokens: number }> {
    const records = await this.getHistory(sessionId);
    return {
      recordCount: records.length,
      estimatedTokens: records.reduce((sum, record) => sum + estimateRecordTokens(record), 0),
    };
  }

  private async tryOpenSession(sessionId: string): Promise<Session | undefined> {
    const meta = await this.findSession(sessionId);
    return meta ? this.repo.open(meta) : undefined;
  }

  private async openOrCreateSession(sessionId: string): Promise<Session> {
    const meta = await this.findSession(sessionId);
    if (meta) {
      return this.repo.open(meta);
    }
    return this.repo.create({ cwd: this.cwd, id: sessionId });
  }

  private async findSession(sessionId: string) {
    const sessions = await this.repo.list();
    return sessions.find((meta) => meta.id === sessionId);
  }

  private async readRecords(session: Session): Promise<ConversationRecord[]> {
    const entries = await session.getEntries();
    return entries
      .filter((entry) => entry.type === 'custom' && entry.customType === RECORD_ENTRY_TYPE)
      .map((entry) => (entry.type === 'custom' ? entry.data : undefined))
      .filter((data): data is ConversationRecord => isConversationRecord(data))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
}

/** 粗略估算一条记录占用的 token（保守字符启发式：4 字符 ≈ 1 token）。 */
export function estimateRecordTokens(record: ConversationRecord): number {
  return Math.ceil((record.question.length + record.answer.length + (record.sql?.length ?? 0)) / 4);
}

function isConversationRecord(value: unknown): value is ConversationRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<ConversationRecord>;
  return (
    typeof record.sessionId === 'string' &&
    typeof record.question === 'string' &&
    typeof record.answer === 'string' &&
    typeof record.createdAt === 'string'
  );
}

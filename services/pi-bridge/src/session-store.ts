import { JsonlSessionRepo, NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { Session } from '@earendil-works/pi-agent-core';
import type { ConversationRecord, MemoryStore } from '@pi-wren/agent-runtime';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** pi session 中存放一条问答记录的 custom entry 类型。 */
export const RECORD_ENTRY_TYPE = 'conversation_record';
/** pi session 中存放会话标题的 custom entry 类型（重命名，最新一条生效）。 */
export const SESSION_META_ENTRY_TYPE = 'session_meta';

/** 会话列表项（供 AI 问答左侧会话栏，需求 4.2）。 */
export interface SessionSummary {
  sessionId: string;
  /** 会话标题：重命名优先，否则取首条提问（截断）。 */
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

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
    await this.enqueue(record.sessionId, async () => {
      const session = await this.openOrCreateSession(record.sessionId);
      await session.appendCustomEntry(RECORD_ENTRY_TYPE, record);
    });
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

  /** 会话列表（按最近更新倒序），供左侧会话栏展示。 */
  async listSessions(): Promise<SessionSummary[]> {
    const summaries: SessionSummary[] = [];
    for (const meta of await this.repo.list()) {
      const session = await this.repo.open(meta);
      const entries = await session.getEntries();
      const records = readConversationRecords(entries);
      if (records.length === 0) {
        continue;
      }
      const first = records[0] as ConversationRecord;
      const last = records[records.length - 1] as ConversationRecord;
      summaries.push({
        sessionId: meta.id,
        name: readSessionTitle(entries) ?? defaultSessionName(first.question),
        createdAt: first.createdAt,
        updatedAt: last.createdAt,
        messageCount: records.length,
      });
    }
    return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /** 某会话完整记录 + 标题（供回看/继续对话）。 */
  async getSession(
    sessionId: string,
  ): Promise<{ name: string; records: ConversationRecord[] } | undefined> {
    if (!isValidSessionId(sessionId)) {
      return undefined;
    }
    const meta = await this.findSession(sessionId);
    if (!meta) {
      return undefined;
    }
    const session = await this.repo.open(meta);
    const entries = await session.getEntries();
    const records = readConversationRecords(entries);
    if (records.length === 0) {
      return undefined;
    }
    const first = records[0] as ConversationRecord;
    return { name: readSessionTitle(entries) ?? defaultSessionName(first.question), records };
  }

  /** 重命名会话（追加 session_meta 条目，最新生效；不影响问答历史）。 */
  async renameSession(sessionId: string, name: string): Promise<void> {
    if (!isValidSessionId(sessionId)) {
      throw new Error('invalid sessionId');
    }
    const title = name.trim();
    if (!title) {
      throw new Error('name is required');
    }
    const session = await this.tryOpenSession(sessionId);
    if (!session) {
      throw new Error('session not found');
    }
    await this.enqueue(sessionId, async () => {
      await session.appendCustomEntry(SESSION_META_ENTRY_TYPE, { title, updatedAt: new Date().toISOString() });
    });
  }

  /** 删除会话（jsonl 文件 + 写队列清理）。返回是否存在该会话。 */
  async deleteSession(sessionId: string): Promise<boolean> {
    if (!isValidSessionId(sessionId)) {
      return false;
    }
    const meta = await this.findSession(sessionId);
    if (!meta) {
      return false;
    }
    await this.repo.delete(meta);
    this.writeQueues.delete(sessionId);
    return true;
  }

  /** 同会话写队列：串行化 append，避免并发写同一 jsonl 文件损坏。 */
  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(task);
    // 队列中失败不影响后续写入；错误向上传播给本次调用
    this.writeQueues.set(
      sessionId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
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
    return readConversationRecords(await session.getEntries());
  }
}

/** 从会话 entries 中提取问答记录（按时间正序）。 */
function readConversationRecords(
  entries: Awaited<ReturnType<Session['getEntries']>>,
): ConversationRecord[] {
  return entries
    .filter((entry) => entry.type === 'custom' && entry.customType === RECORD_ENTRY_TYPE)
    .map((entry) => (entry.type === 'custom' ? entry.data : undefined))
    .filter((data): data is ConversationRecord => isConversationRecord(data))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** 读取会话标题（session_meta 最新一条）。 */
function readSessionTitle(entries: Awaited<ReturnType<Session['getEntries']>>): string | undefined {
  const titles = entries
    .filter((entry) => entry.type === 'custom' && entry.customType === SESSION_META_ENTRY_TYPE)
    .map((entry) => {
      if (entry.type !== 'custom') {
        return undefined;
      }
      const data = entry.data as { title?: unknown } | undefined;
      return typeof data?.title === 'string' ? data.title : undefined;
    })
    .filter((title): title is string => typeof title === 'string' && title.trim() !== '');
  return titles[titles.length - 1];
}

/** 默认会话名：首条提问去空白并截断。 */
export function defaultSessionName(question: string): string {
  const single = question.replace(/\s+/g, ' ').trim();
  return single.length > 30 ? `${single.slice(0, 30)}…` : single;
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

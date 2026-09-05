import { appendFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertId(value, label) {
  if (!ID_RE.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function sessionFile(dataDir, userKey, sessionId) {
  return join(dataDir, assertId(userKey, 'user'), `${assertId(sessionId, 'sessionId')}.jsonl`);
}

/** JSONL 会话存储：dataDir/<userKey>/<sessionId>.jsonl，每行一个 turn（HA 阶段换 Postgres 实现，接口不变）。 */
export function createSessionStore(dataDir) {
  return {
    /** 追加一轮问答。turn: {question, answer, at} */
    async appendTurn(userKey, sessionId, turn) {
      const file = sessionFile(dataDir, userKey, sessionId);
      await mkdir(join(dataDir, userKey), { recursive: true });
      await appendFile(file, `${JSON.stringify(turn)}\n`, 'utf8');
    },

    /** 会话摘要列表（name 取首个提问，updatedAt 取末行时间），按更新时间倒序；search 按名称子串过滤。 */
    async list(userKey, search = '') {
      const dir = join(dataDir, assertId(userKey, 'user'));
      let files;
      try {
        files = await readdir(dir);
      } catch {
        return [];
      }
      const keyword = String(search ?? '').trim().toLowerCase();
      const sessions = await Promise.all(
        files
          .filter((f) => f.endsWith('.jsonl'))
          .map(async (f) => {
            const id = f.slice(0, -'.jsonl'.length);
            try {
              const lines = (await readFile(join(dir, f), 'utf8')).split('\n').filter(Boolean);
              const first = JSON.parse(lines[0]);
              const last = JSON.parse(lines[lines.length - 1]);
              return {
                id,
                name: String(first.question).slice(0, 40),
                updatedAt: last.at ?? '',
                turnCount: lines.length,
              };
            } catch {
              return null; // 损坏会话隔离：列表跳过
            }
          }),
      );
      const items = sessions.filter(Boolean);
      const filtered = keyword
        ? items.filter((s) => s.name.toLowerCase().includes(keyword) || s.id.toLowerCase().includes(keyword))
        : items;
      return filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },

    /** 单会话完整记录；不存在返回 null。 */
    async get(userKey, sessionId) {
      const file = sessionFile(dataDir, userKey, sessionId); // ID 校验在 try 外，非法 ID 直接抛错
      let raw;
      try {
        raw = await readFile(file, 'utf8');
      } catch {
        return null;
      }
      const lines = raw.split('\n').filter(Boolean);
      const turns = lines.map((line) => JSON.parse(line));
      const messages = [];
      for (const turn of turns) {
        messages.push({ role: 'user', content: turn.question, at: turn.at });
        messages.push({ role: 'assistant', content: turn.answer, sql: turn.sql, data: turn.data, at: turn.at });
      }
      return { name: String(turns[0]?.question ?? '').slice(0, 40), sessionId, messages };
    },

    async remove(userKey, sessionId) {
      await rm(sessionFile(dataDir, userKey, sessionId), { force: true });
    },

    /** 最近 N 轮问答（供系统提示词注入），返回 [{question, answer}]。 */
    async history(userKey, sessionId, limit = 3) {
      const session = await this.get(userKey, sessionId);
      if (!session) return [];
      const turns = [];
      for (let i = 0; i < session.messages.length; i += 2) {
        const q = session.messages[i];
        const a = session.messages[i + 1];
        if (q && a) turns.push({ question: q.content, answer: a.content });
      }
      return turns.slice(-limit);
    },
  };
}

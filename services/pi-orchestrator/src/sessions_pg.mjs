/** Postgres 会话存储：与 sessions.mjs（JSONL）同接口，生产多副本共享。
 *  表 pi_session_turn 由 ensureSchema() 自建（幂等），业务表不受影响。 */
import pg from 'pg';

const DDL = `
CREATE TABLE IF NOT EXISTS pi_session_turn (
    id          bigserial PRIMARY KEY,
    user_key    varchar(64)  NOT NULL,
    session_id  varchar(64)  NOT NULL,
    question    text         NOT NULL,
    answer      text         NOT NULL,
    sql_text    text,
    data_json   jsonb,
    created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pi_session_turn
    ON pi_session_turn (user_key, session_id, id);
`;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function assertId(value, label) {
  if (!ID_RE.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

export function createPgSessionStore(dbConfig, poolOverride = null) {
  const pool = poolOverride ?? new pg.Pool(dbConfig);

  const store = {
    async ensureSchema() {
      await pool.query(DDL);
    },

    async appendTurn(userKey, sessionId, turn) {
      await pool.query(
        `INSERT INTO pi_session_turn (user_key, session_id, question, answer, sql_text, data_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now()))`,
        [assertId(userKey, 'user'), assertId(sessionId, 'sessionId'),
         turn.question, turn.answer, turn.sql ?? null,
         turn.data ? JSON.stringify(turn.data) : null, turn.at ?? null],
      );
    },

    async list(userKey, search = '') {
      const keyword = String(search ?? '').trim();
      const result = await pool.query(
        `SELECT s.session_id AS "sessionId", s.name, s.updated_at AS "updatedAt", s.turn_count AS "turnCount"
         FROM (SELECT t.session_id,
                      (SELECT t2.question FROM pi_session_turn t2
                        WHERE t2.user_key = t.user_key AND t2.session_id = t.session_id
                        ORDER BY t2.id LIMIT 1) AS name,
                      MAX(t.created_at) AS updated_at,
                      COUNT(*) AS turn_count
                 FROM pi_session_turn t
                WHERE t.user_key = $1
                GROUP BY t.user_key, t.session_id) s
        WHERE ($2 = '' OR s.name ILIKE '%' || $2 || '%' OR s.session_id ILIKE '%' || $2 || '%')
        ORDER BY s.updated_at DESC`,
        [assertId(userKey, 'user'), keyword],
      );
      return result.rows.map((r) => ({
        id: r.sessionId,
        name: String(r.name ?? '').slice(0, 40),
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : '',
        turnCount: Number(r.turnCount ?? 0),
      }));
    },

    async get(userKey, sessionId) {
      const result = await pool.query(
        `SELECT question, answer, sql_text, data_json, created_at
           FROM pi_session_turn
          WHERE user_key = $1 AND session_id = $2
          ORDER BY id`,
        [assertId(userKey, 'user'), assertId(sessionId, 'sessionId')],
      );
      if (result.rowCount === 0) return null;
      const turns = result.rows;
      const messages = [];
      for (const turn of turns) {
        messages.push({ role: 'user', content: turn.question, at: turn.created_at });
        messages.push({
          role: 'assistant', content: turn.answer,
          sql: turn.sql_text, data: turn.data_json, at: turn.created_at,
        });
      }
      return { name: String(turns[0]?.question ?? '').slice(0, 40), sessionId, messages };
    },

    async remove(userKey, sessionId) {
      await pool.query(
        'DELETE FROM pi_session_turn WHERE user_key = $1 AND session_id = $2',
        [assertId(userKey, 'user'), assertId(sessionId, 'sessionId')],
      );
    },

    async history(userKey, sessionId, limit = 3) {
      const session = await store.get(userKey, sessionId);
      if (!session) return [];
      const turns = [];
      for (let i = 0; i < session.messages.length; i += 2) {
        const q = session.messages[i];
        const a = session.messages[i + 1];
        if (q && a) turns.push({ question: q.content, answer: a.content });
      }
      return turns.slice(-limit);
    },

    async close() {
      await pool.end();
    },
  };
  return store;
}

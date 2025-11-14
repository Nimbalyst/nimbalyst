/**
 * PGLite implementation of AgentMessagesStore interface from runtime package
 */

import type {
  AgentMessage,
  CreateAgentMessageInput,
} from '@nimbalyst/runtime';
import type { AgentMessagesStore } from '@nimbalyst/runtime/storage/repositories/AgentMessagesRepository';

type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

export function createPGLiteAgentMessagesStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn): AgentMessagesStore {
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    async create(message: CreateAgentMessageInput): Promise<void> {
      await ensureReady();
      await db.query(
        `INSERT INTO ai_agent_messages (
          session_id, source, direction, content, metadata, hidden
        ) VALUES (
          $1, $2, $3, $4, $5, $6
        )`,
        [
          message.sessionId,
          message.source,
          message.direction,
          message.content,
          message.metadata ?? null,
          message.hidden ?? false,
        ]
      );
    },

    async list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]> {
      await ensureReady();
      const limit = options?.limit;
      const offset = options?.offset ?? 0;
      const includeHidden = options?.includeHidden ?? false;

      let query = `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
         FROM ai_agent_messages
         WHERE session_id = $1${includeHidden ? '' : ' AND hidden = FALSE'}
         ORDER BY id ASC`;

      const params: any[] = [sessionId];
      if (typeof limit === 'number') {
        query += ' LIMIT $2 OFFSET $3';
        params.push(limit, offset);
      } else if (offset > 0) {
        query += ' OFFSET $2';
        params.push(offset);
      }

      const { rows } = await db.query<any>(query, params);

      return rows.map(row => ({
        id: Number(row.id),
        sessionId: row.session_id,
        createdAt: row.created_at ? new Date(row.created_at) : undefined,
        source: row.source,
        direction: row.direction,
        content: row.content,
        metadata: row.metadata ?? undefined,
        hidden: row.hidden ?? false,
      }));
    },
  };
}

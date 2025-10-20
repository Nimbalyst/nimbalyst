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
          session_id, source, direction, content, metadata
        ) VALUES (
          $1, $2, $3, $4, $5
        )`,
        [
          message.sessionId,
          message.source,
          message.direction,
          message.content,
          message.metadata ?? null,
        ]
      );
    },

    async list(sessionId: string, options?: { limit?: number; offset?: number }): Promise<AgentMessage[]> {
      await ensureReady();
      const limit = options?.limit ?? 100;
      const offset = options?.offset ?? 0;

      const { rows } = await db.query<any>(
        `SELECT id, session_id, created_at, source, direction, content, metadata
         FROM ai_agent_messages
         WHERE session_id = $1
         ORDER BY id ASC
         LIMIT $2 OFFSET $3`,
        [sessionId, limit, offset]
      );

      return rows.map(row => ({
        id: Number(row.id),
        sessionId: row.session_id,
        createdAt: row.created_at ? new Date(row.created_at) : undefined,
        source: row.source,
        direction: row.direction,
        content: row.content,
        metadata: row.metadata ?? undefined,
      }));
    },
  };
}

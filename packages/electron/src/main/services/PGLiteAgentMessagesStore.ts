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

      // Insert the message and update the session's updated_at timestamp in one transaction
      await db.query('BEGIN', []);

      try {
        // Use provided createdAt timestamp if available, otherwise default to NOW()
        const hasCustomTimestamp = message.createdAt !== undefined;
        const insertQuery = hasCustomTimestamp
          ? `INSERT INTO ai_agent_messages (
              session_id, source, direction, content, metadata, hidden, created_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7
            )`
          : `INSERT INTO ai_agent_messages (
              session_id, source, direction, content, metadata, hidden
            ) VALUES (
              $1, $2, $3, $4, $5, $6
            )`;

        const params = [
          message.sessionId,
          message.source,
          message.direction,
          message.content,
          message.metadata ? JSON.stringify(message.metadata) : null,
          message.hidden ?? false,
        ];

        if (hasCustomTimestamp) {
          // Convert createdAt to Date object if it's a string
          const timestamp = message.createdAt instanceof Date
            ? message.createdAt
            : new Date(message.createdAt);
          params.push(timestamp);
        }

        await db.query(insertQuery, params);

        // Update the session's updated_at timestamp so it appears at the top of the list
        await db.query(
          `UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [message.sessionId]
        );

        await db.query('COMMIT', []);
      } catch (error) {
        await db.query('ROLLBACK', []);
        throw error;
      }
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

      return rows.map(row => {
        // Parse metadata if it's a string (JSONB may come back as string or object)
        let metadata = row.metadata;
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch {
            // Keep as string if parsing fails
          }
        }
        return {
          id: Number(row.id),
          sessionId: row.session_id,
          createdAt: row.created_at ? new Date(row.created_at) : undefined,
          source: row.source,
          direction: row.direction,
          content: row.content,
          metadata: metadata ?? undefined,
          hidden: row.hidden ?? false,
        };
      });
    },
  };
}

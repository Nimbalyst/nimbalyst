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

      // REQUIRE createdAt - it must come from the source (AIProvider)
      // This ensures sync timestamps match exactly
      if (!message.createdAt) {
        throw new Error('message.createdAt is required - timestamp must originate from message source');
      }

      const timestamp = message.createdAt instanceof Date
        ? message.createdAt
        : new Date(message.createdAt);

      // Insert the message and update the session's updated_at timestamp in one transaction
      await db.query('BEGIN', []);

      try {
        await db.query(
          `INSERT INTO ai_agent_messages (
            session_id, source, direction, content, metadata, hidden, created_at, provider_message_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8
          )`,
          [
            message.sessionId,
            message.source,
            message.direction,
            message.content,
            message.metadata ? JSON.stringify(message.metadata) : null,
            message.hidden ?? false,
            timestamp,
            message.providerMessageId ?? null,
          ]
        );

        // Update session's updated_at to SAME timestamp as message
        // This ensures local DB and sync have identical timestamps
        await db.query(
          `UPDATE ai_sessions SET updated_at = $2 WHERE id = $1`,
          [message.sessionId, timestamp]
        );

        await db.query('COMMIT', []);
      } catch (error) {
        await db.query('ROLLBACK', []);
        throw error;
      }
    },

    async list(sessionId: string, options?: { limit?: number; offset?: number; includeHidden?: boolean }): Promise<AgentMessage[]> {
      await ensureReady();

      // Safeguard: limit maximum messages loaded to prevent OOM from corrupted sessions
      // Sessions with more than 5000 messages are likely corrupted by sync bugs
      const MAX_MESSAGES = 5000;
      const limit = options?.limit ? Math.min(options.limit, MAX_MESSAGES) : MAX_MESSAGES;
      const offset = options?.offset ?? 0;
      const includeHidden = options?.includeHidden ?? false;

      const query = `SELECT id, session_id, created_at, source, direction, content, metadata, hidden, provider_message_id
         FROM ai_agent_messages
         WHERE session_id = $1${includeHidden ? '' : ' AND hidden = FALSE'}
         ORDER BY id ASC
         LIMIT $2 OFFSET $3`;

      const params: any[] = [sessionId, limit, offset];
      const { rows } = await db.query<any>(query, params);

      // Log warning if we hit the limit (indicates potential corruption)
      if (rows.length >= MAX_MESSAGES) {
        console.warn(`[PGLiteAgentMessagesStore.list] WARNING: Session ${sessionId} has ${rows.length}+ messages (capped at ${MAX_MESSAGES}). May indicate sync corruption.`);
      }

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
          providerMessageId: row.provider_message_id ?? undefined,
        };
      });
    },
  };
}

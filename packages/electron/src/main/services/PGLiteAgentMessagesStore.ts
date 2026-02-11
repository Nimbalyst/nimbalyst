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
            session_id, source, direction, content, metadata, hidden, created_at, provider_message_id, searchable
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9
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
            message.searchable ?? false,
          ]
        );

        // Update session's updated_at to SAME timestamp as message
        // This ensures local DB and sync have identical timestamps
        // Also unarchive the session if it was archived - sending a new message
        // means the user wants to continue the conversation
        await db.query(
          `UPDATE ai_sessions SET updated_at = $2, is_archived = FALSE WHERE id = $1`,
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
      const MAX_MESSAGES = 50000;
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

    async getMessageCounts(sessionIds: string[]): Promise<Map<string, number>> {
      await ensureReady();

      if (sessionIds.length === 0) {
        return new Map();
      }

      // Build parameterized query with placeholders
      const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(', ');
      const query = `
        SELECT session_id, COUNT(*) as count
        FROM ai_agent_messages
        WHERE session_id IN (${placeholders}) AND hidden = FALSE
        GROUP BY session_id
      `;

      const { rows } = await db.query<{ session_id: string; count: string }>(query, sessionIds);

      const counts = new Map<string, number>();
      // Initialize all requested session IDs with 0
      for (const sessionId of sessionIds) {
        counts.set(sessionId, 0);
      }
      // Update with actual counts
      for (const row of rows) {
        counts.set(row.session_id, parseInt(row.count, 10));
      }

      return counts;
    },
  };
}

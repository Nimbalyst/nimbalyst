/**
 * Thin adapters that bridge existing PGLite stores to the interfaces
 * expected by TranscriptTransformer / TranscriptMigrationService.
 */

import type { IRawMessageStore, ISessionMetadataStore, RawMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptTransformer';
import { database } from '../database/PGLiteDatabaseWorker';

// ---------------------------------------------------------------------------
// IRawMessageStore -- wraps ai_agent_messages queries
// ---------------------------------------------------------------------------

export function createRawMessageStoreAdapter(): IRawMessageStore {
  return {
    async getMessages(sessionId: string, afterId?: number): Promise<RawMessage[]> {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      let sql: string;
      let params: any[];

      if (afterId != null) {
        sql = `SELECT id, session_id, source, direction, content, created_at, metadata, hidden
               FROM ai_agent_messages
               WHERE session_id = $1 AND id > $2
               ORDER BY id ASC`;
        params = [sessionId, afterId];
      } else {
        sql = `SELECT id, session_id, source, direction, content, created_at, metadata, hidden
               FROM ai_agent_messages
               WHERE session_id = $1
               ORDER BY id ASC`;
        params = [sessionId];
      }

      const { rows } = await database.query<any>(sql, params);

      return rows.map((row: any) => {
        let metadata = row.metadata;
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch {
            metadata = undefined;
          }
        }

        return {
          id: Number(row.id),
          sessionId: row.session_id,
          source: row.source,
          direction: row.direction,
          content: row.content,
          createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
          metadata: metadata ?? undefined,
          hidden: row.hidden ?? false,
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// ISessionMetadataStore -- wraps ai_sessions canonical_transform_* columns
// ---------------------------------------------------------------------------

export function createSessionMetadataStoreAdapter(): ISessionMetadataStore {
  return {
    async getTransformStatus(sessionId: string) {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      const { rows } = await database.query<any>(
        `SELECT canonical_transform_version, canonical_last_raw_message_id,
                canonical_last_transformed_at, canonical_transform_status
         FROM ai_sessions WHERE id = $1`,
        [sessionId],
      );

      if (rows.length === 0) {
        return {
          transformVersion: null,
          lastRawMessageId: null,
          lastTransformedAt: null,
          transformStatus: null,
        };
      }

      const row = rows[0];
      return {
        transformVersion: row.canonical_transform_version ?? null,
        lastRawMessageId: row.canonical_last_raw_message_id != null
          ? Number(row.canonical_last_raw_message_id)
          : null,
        lastTransformedAt: row.canonical_last_transformed_at
          ? (row.canonical_last_transformed_at instanceof Date
              ? row.canonical_last_transformed_at
              : new Date(row.canonical_last_transformed_at))
          : null,
        transformStatus: row.canonical_transform_status ?? null,
      };
    },

    async updateTransformStatus(sessionId: string, update) {
      if (!database.isInitialized()) {
        await database.initialize();
      }

      await database.query(
        `UPDATE ai_sessions
         SET canonical_transform_version = $2,
             canonical_last_raw_message_id = $3,
             canonical_last_transformed_at = $4,
             canonical_transform_status = $5
         WHERE id = $1`,
        [
          sessionId,
          update.transformVersion,
          update.lastRawMessageId,
          update.lastTransformedAt,
          update.transformStatus,
        ],
      );
    },
  };
}

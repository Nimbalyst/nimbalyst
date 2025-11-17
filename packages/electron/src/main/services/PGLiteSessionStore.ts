/**
 * PGLite implementation of SessionStore interface from runtime package
 */

import type {
  SessionStore,
  SessionListItem,
  CreateSessionPayload,
  UpdateSessionMetadataPayload,
  ChatMessage,
  ChatSession
} from '@nimbalyst/runtime';

type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

function toMillis(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value as any).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}


export function createPGLiteSessionStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn): SessionStore {
  const ensureReady = async () => {
    if (ensureDbReady) {
      await ensureDbReady();
    }
  };

  return {
    async ensureReady(): Promise<void> {
      await ensureReady();
    },

    async create(payload: CreateSessionPayload): Promise<void> {
      await ensureReady();
      const now = Date.now();
      const createdAt = payload.createdAt ?? now;
      const updatedAt = payload.updatedAt ?? now;

      // TODO: Debug logging - uncomment if needed
      // console.log('[PGLiteSessionStore] Creating session:', {
      //   id: payload.id,
      //   workspaceId: payload.workspaceId,
      //   provider: payload.provider,
      //   sessionType: (payload as any).sessionType
      // });

      await db.query(
        `INSERT INTO ai_sessions (
          id, workspace_id, file_path, provider, model, title, session_type,
          document_context, provider_config, provider_session_id, draft_input, metadata,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          to_timestamp($13 / 1000.0), to_timestamp($14 / 1000.0)
        )
        ON CONFLICT (id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          file_path = EXCLUDED.file_path,
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          title = EXCLUDED.title,
          session_type = EXCLUDED.session_type,
          document_context = EXCLUDED.document_context,
          provider_config = EXCLUDED.provider_config,
          provider_session_id = EXCLUDED.provider_session_id,
          draft_input = EXCLUDED.draft_input,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
        [
          payload.id,
          payload.workspaceId,
          payload.filePath ?? null,
          payload.provider,
          payload.model ?? null,
          payload.title ?? 'New conversation',
          (payload as any).sessionType ?? 'chat',
          payload.documentContext ?? null,
          payload.providerConfig ?? null,
          payload.providerSessionId ?? null,
          null,
          (payload as any).metadata ?? {},
          createdAt,
          updatedAt,
        ]
      );

      // TODO: Debug logging - uncomment if needed
      // console.log('[PGLiteSessionStore] Session created successfully in database');
    },


    async updateMetadata(sessionId: string, metadata: UpdateSessionMetadataPayload): Promise<void> {
      await ensureReady();
      const updates: string[] = [];
      const values: any[] = [sessionId];

      const pushUpdate = (clause: string, value: any) => {
        updates.push(`${clause} $${values.length + 1}`);
        values.push(value);
      };

      if (metadata.provider !== undefined) pushUpdate('provider =', metadata.provider);
      if (metadata.model !== undefined) pushUpdate('model =', metadata.model);
      if (metadata.title !== undefined) pushUpdate('title =', metadata.title ?? 'New conversation');
      if ((metadata as any).sessionType !== undefined) pushUpdate('session_type =', (metadata as any).sessionType);
      if (metadata.workspaceId !== undefined) pushUpdate('workspace_id =', metadata.workspaceId);
      if (metadata.filePath !== undefined) pushUpdate('file_path =', metadata.filePath ?? null);
      if (metadata.providerConfig !== undefined) pushUpdate('provider_config =', metadata.providerConfig ?? null);
      if (metadata.providerSessionId !== undefined) pushUpdate('provider_session_id =', metadata.providerSessionId ?? null);
      if (metadata.documentContext !== undefined) pushUpdate('document_context =', metadata.documentContext ?? null);
      if (metadata.draftInput !== undefined) pushUpdate('draft_input =', metadata.draftInput ?? null);
      // NOTE: tokenUsage removed - it's derived from ai_agent_messages /context responses
      if ((metadata as any).metadata !== undefined) pushUpdate('metadata =', (metadata as any).metadata ?? {});

      if (!updates.length) {
        // Nothing to update but still touch the row so updated_at changes
        await db.query(
          'UPDATE ai_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id=$1',
          [sessionId]
        );
        return;
      }

      const setClause = `${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP`;
      await db.query(
        `UPDATE ai_sessions SET ${setClause} WHERE id=$1`,
        values
      );
    },

    async get(sessionId: string): Promise<ChatSession | null> {
      await ensureReady();
      const { rows } = await db.query<any>(
        `SELECT *,
         EXTRACT(EPOCH FROM last_read_timestamp) * 1000 AS last_read_ms
         FROM ai_sessions WHERE id=$1 LIMIT 1`,
        [sessionId]
      );
      const row = rows[0];
      if (!row) return null;

      // NOTE: tokenUsage is no longer stored in ai_sessions
      // It's derived from ai_agent_messages /context responses when loading sessions
      const metadata = row.metadata ?? {};

      return {
        id: row.id,
        provider: row.provider,
        model: row.model ?? undefined,
        sessionType: row.session_type ?? undefined,
        title: row.title ?? undefined,
        draftInput: row.draft_input ?? undefined,
        messages: [], // Messages are now stored in ai_agent_messages table
        workspacePath: row.workspace_id,
        createdAt: toMillis(row.created_at),
        updatedAt: toMillis(row.updated_at),
        metadata,
        documentContext: row.document_context ?? undefined,
        providerConfig: row.provider_config ?? undefined,
        providerSessionId: row.provider_session_id ?? undefined,
        lastReadMessageTimestamp: row.last_read_ms ? Number(row.last_read_ms) : undefined,
      } satisfies ChatSession;
    },

    async list(workspaceId: string): Promise<SessionListItem[]> {
      await ensureReady();
      const { rows } = await db.query<any>(
        `SELECT s.id, s.provider, s.model, s.session_type, s.title, s.workspace_id,
                s.created_at, s.updated_at, COUNT(m.id) as message_count
         FROM ai_sessions s
         LEFT JOIN ai_agent_messages m ON s.id = m.session_id AND m.direction = 'input'
         WHERE s.workspace_id=$1
         GROUP BY s.id, s.provider, s.model, s.session_type, s.title, s.workspace_id,
                  s.created_at, s.updated_at
         ORDER BY s.updated_at DESC`,
        [workspaceId]
      );
      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        const messageCount = parseInt(row.message_count) || 0;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type ?? undefined,
          title: row.title ?? undefined,
          workspaceId: row.workspace_id,
          createdAt,
          updatedAt,
          messageCount,
        };
      });
    },

    async search(workspaceId: string, query: string): Promise<SessionListItem[]> {
      await ensureReady();

      // If query is empty, return all sessions (same as list)
      if (!query || query.trim().length === 0) {
        return this.list(workspaceId);
      }

      // Sanitize query for FTS - replace special characters and prepare for tsquery
      const searchTerms = query.trim().split(/\s+/).filter(Boolean).join(' & ');

      const { rows } = await db.query<any>(
        `WITH session_matches AS (
          -- Search in session titles
          SELECT
            s.id,
            s.provider,
            s.model,
            s.session_type,
            s.title,
            s.workspace_id,
            s.created_at,
            s.updated_at,
            ts_rank_cd(to_tsvector('english', COALESCE(s.title, '')), to_tsquery('english', $2)) * 2 as rank
          FROM ai_sessions s
          WHERE s.workspace_id = $1
            AND to_tsvector('english', COALESCE(s.title, '')) @@ to_tsquery('english', $2)

          UNION

          -- Search in message content
          SELECT DISTINCT
            s.id,
            s.provider,
            s.model,
            s.session_type,
            s.title,
            s.workspace_id,
            s.created_at,
            s.updated_at,
            MAX(ts_rank_cd(to_tsvector('english', m.content), to_tsquery('english', $2))) as rank
          FROM ai_sessions s
          INNER JOIN ai_agent_messages m ON s.id = m.session_id
          WHERE s.workspace_id = $1
            AND to_tsvector('english', m.content) @@ to_tsquery('english', $2)
          GROUP BY s.id, s.provider, s.model, s.session_type, s.title, s.workspace_id,
                   s.created_at, s.updated_at
        )
        SELECT
          sm.id,
          sm.provider,
          sm.model,
          sm.session_type,
          sm.title,
          sm.workspace_id,
          sm.created_at,
          sm.updated_at,
          MAX(sm.rank) as max_rank,
          COUNT(m.id) as message_count
        FROM session_matches sm
        LEFT JOIN ai_agent_messages m ON sm.id = m.session_id AND m.direction = 'input'
        GROUP BY sm.id, sm.provider, sm.model, sm.session_type, sm.title, sm.workspace_id,
                 sm.created_at, sm.updated_at
        ORDER BY max_rank DESC, sm.updated_at DESC`,
        [workspaceId, searchTerms]
      );

      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        const messageCount = parseInt(row.message_count) || 0;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type ?? undefined,
          title: row.title ?? undefined,
          workspaceId: row.workspace_id,
          createdAt,
          updatedAt,
          messageCount,
        };
      });
    },

    async delete(sessionId: string): Promise<void> {
      await ensureReady();
      await db.query('DELETE FROM ai_sessions WHERE id=$1', [sessionId]);
    },
  };
}

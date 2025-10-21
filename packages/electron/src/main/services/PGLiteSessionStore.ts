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
      await db.query(
        `INSERT INTO ai_sessions (
          id, workspace_id, file_path, provider, model, title, session_type,
          document_context, provider_config, provider_session_id, draft_input, metadata,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12,
          to_timestamp($13 / 1000.0), to_timestamp($13 / 1000.0)
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
          now,
        ]
      );
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
        'SELECT * FROM ai_sessions WHERE id=$1 LIMIT 1',
        [sessionId]
      );
      const row = rows[0];
      if (!row) return null;

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
        metadata: row.metadata ?? {},
        documentContext: row.document_context ?? undefined,
        providerConfig: row.provider_config ?? undefined,
        providerSessionId: row.provider_session_id ?? undefined,
      } satisfies ChatSession;
    },

    async list(workspaceId: string): Promise<SessionListItem[]> {
      await ensureReady();
      const { rows } = await db.query<any>(
        `SELECT id, provider, model, session_type, title, workspace_id, created_at, updated_at
         FROM ai_sessions
         WHERE workspace_id=$1
         ORDER BY updated_at DESC`,
        [workspaceId]
      );
      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        // console.log('[PGLiteSessionStore] Session dates:', {
        //   id: row.id.substring(0, 8),
        //   raw_created_at: row.created_at,
        //   raw_updated_at: row.updated_at,
        //   created_at_type: typeof row.created_at,
        //   updated_at_type: typeof row.updated_at,
        //   createdAt,
        //   updatedAt,
        //   created_date: new Date(createdAt).toISOString(),
        //   updated_date: new Date(updatedAt).toISOString()
        // });
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type ?? undefined,
          title: row.title ?? undefined,
          workspaceId: row.workspace_id,
          createdAt,
          updatedAt,
        };
      });
    },

    async delete(sessionId: string): Promise<void> {
      await ensureReady();
      await db.query('DELETE FROM ai_sessions WHERE id=$1', [sessionId]);
    },
  };
}

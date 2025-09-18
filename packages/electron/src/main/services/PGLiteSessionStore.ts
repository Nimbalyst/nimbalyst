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
} from '@stravu/runtime';

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

function normaliseMessages(raw: unknown): ChatMessage[] {
  if (Array.isArray(raw)) {
    return raw as ChatMessage[];
  }
  if (!raw) return [];
  try {
    if (typeof raw === 'string') {
      return JSON.parse(raw) as ChatMessage[];
    }
    if (typeof raw === 'object') {
      return JSON.parse(JSON.stringify(raw)) as ChatMessage[];
    }
  } catch (error) {
    console.warn('[PGLiteSessionStore] Failed to parse messages payload', error);
  }
  return [];
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
          id, workspace_id, file_path, provider, model, title,
          document_context, provider_config, provider_session_id, draft_input,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          to_timestamp($11 / 1000.0), to_timestamp($11 / 1000.0)
        )
        ON CONFLICT (id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          file_path = EXCLUDED.file_path,
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          title = EXCLUDED.title,
          document_context = EXCLUDED.document_context,
          provider_config = EXCLUDED.provider_config,
          provider_session_id = EXCLUDED.provider_session_id,
          draft_input = EXCLUDED.draft_input,
          updated_at = EXCLUDED.updated_at
      `,
        [
          payload.id,
          payload.workspaceId,
          payload.filePath ?? null,
          payload.provider,
          payload.model ?? null,
          payload.title ?? 'New conversation',
          payload.documentContext ?? null,
          payload.providerConfig ?? null,
          payload.providerSessionId ?? null,
          null,
          now,
        ]
      );
    },

    async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
      await ensureReady();
      const result = await db.query<{ messages: any }>(
        'SELECT messages FROM ai_sessions WHERE id=$1 LIMIT 1',
        [sessionId]
      );
      const existing = normaliseMessages(result.rows[0]?.messages);
      existing.push(message);
      await db.query(
        `UPDATE ai_sessions
         SET messages=$2, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [sessionId, existing]
      );
    },

    async replaceMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
      await ensureReady();
      await db.query(
        `UPDATE ai_sessions
         SET messages=$2, updated_at=CURRENT_TIMESTAMP
         WHERE id=$1`,
        [sessionId, messages]
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
      if (metadata.workspaceId !== undefined) pushUpdate('workspace_id =', metadata.workspaceId);
      if (metadata.filePath !== undefined) pushUpdate('file_path =', metadata.filePath ?? null);
      if (metadata.providerConfig !== undefined) pushUpdate('provider_config =', metadata.providerConfig ?? null);
      if (metadata.providerSessionId !== undefined) pushUpdate('provider_session_id =', metadata.providerSessionId ?? null);
      if (metadata.documentContext !== undefined) pushUpdate('document_context =', metadata.documentContext ?? null);
      if (metadata.draftInput !== undefined) pushUpdate('draft_input =', metadata.draftInput ?? null);

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
        title: row.title ?? undefined,
        draftInput: row.draft_input ?? undefined,
        messages: normaliseMessages(row.messages),
        createdAt: toMillis(row.created_at),
        updatedAt: toMillis(row.updated_at),
        metadata: {
          workspaceId: row.workspace_id,
          filePath: row.file_path ?? undefined,
          documentContext: row.document_context ?? undefined,
          providerConfig: row.provider_config ?? undefined,
          providerSessionId: row.provider_session_id ?? undefined,
        },
      } satisfies ChatSession;
    },

    async list(workspaceId: string): Promise<SessionListItem[]> {
      await ensureReady();
      const { rows } = await db.query<any>(
        `SELECT id, provider, model, title, workspace_id, updated_at
         FROM ai_sessions
         WHERE workspace_id=$1
         ORDER BY updated_at DESC`,
        [workspaceId]
      );
      return rows.map(row => ({
        id: row.id,
        provider: row.provider,
        model: row.model ?? undefined,
        title: row.title ?? undefined,
        workspaceId: row.workspace_id,
        updatedAt: toMillis(row.updated_at),
      }));
    },

    async delete(sessionId: string): Promise<void> {
      await ensureReady();
      await db.query('DELETE FROM ai_sessions WHERE id=$1', [sessionId]);
    },
  };
}
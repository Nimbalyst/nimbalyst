/**
 * PGLite implementation of SessionStore interface from runtime package
 */

import type {
  SessionStore,
  SessionListItem,
  SessionListOptions,
  CreateSessionPayload,
  UpdateSessionMetadataPayload,
  ChatMessage,
  ChatSession,
  AgentMessage
} from '@nimbalyst/runtime';

type PGliteLike = {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
};

type EnsureReadyFn = () => Promise<void>;

function toMillis(value: unknown): number {
  if (!value) return Date.now();
  if (typeof value === 'number') return value;

  // PGlite returns Date objects that are already parsed as LOCAL time
  // But PostgreSQL stores them as UTC, so we need to adjust
  if (value instanceof Date) {
    // Get the components as if they were UTC
    const year = value.getFullYear();
    const month = value.getMonth();
    const day = value.getDate();
    const hour = value.getHours();
    const minute = value.getMinutes();
    const second = value.getSeconds();
    const ms = value.getMilliseconds();

    // Create a UTC date from those components
    return Date.UTC(year, month, day, hour, minute, second, ms);
  }

  // Fallback for string timestamps
  const str = String(value).trim();
  const hasTimezone = str.endsWith('Z') || str.includes('+') || /[0-9]-\d{2}:\d{2}$/. test(str);
  const utcStr = hasTimezone ? str : str.replace(' ', 'T') + 'Z';
  const parsed = new Date(utcStr).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}


// Module-level reference for standalone functions
let moduleDb: PGliteLike | null = null;
let moduleEnsureReady: EnsureReadyFn | null = null;

/**
 * Get the database instance for direct queries (e.g., migrations)
 */
export function getDatabase(): PGliteLike | null {
  return moduleDb;
}

// Use AgentMessage from runtime for sync compatibility
type SyncedMessage = AgentMessage;

/**
 * Get all sessions for sync (no workspace filter)
 * Uses the module-level db reference set by createPGLiteSessionStore
 */
export async function getAllSessionsForSync(includeMessages = false): Promise<Array<{
  id: string;
  title: string;
  provider: string;
  model?: string;
  mode?: string;
  workspaceId?: string;
  workspacePath?: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  messages?: SyncedMessage[];
}>> {
  // Log stack trace to identify callers
  const stack = new Error().stack?.split('\n').slice(1, 5).join('\n') || 'no stack';
  console.log('[PGLiteSessionStore] getAllSessionsForSync called from:\n' + stack);

  const startTime = performance.now();
  if (!moduleDb) {
    throw new Error('Session store not initialized');
  }
  if (moduleEnsureReady) {
    await moduleEnsureReady();
  }
  const ensureTime = performance.now() - startTime;

  const queryStart = performance.now();
  const { rows } = await moduleDb.query<any>(
    `SELECT s.id, s.provider, s.model, s.mode, s.title, s.workspace_id, s.draft_input,
            s.created_at, s.updated_at, COUNT(m.id) as message_count
     FROM ai_sessions s
     LEFT JOIN ai_agent_messages m ON s.id = m.session_id AND m.direction = 'input'
     WHERE (s.is_archived = FALSE OR s.is_archived IS NULL)
     GROUP BY s.id, s.provider, s.model, s.mode, s.title, s.workspace_id, s.draft_input, s.created_at, s.updated_at
     ORDER BY s.updated_at DESC`
  );
  const queryTime = performance.now() - queryStart;

  const sessions = rows.map((row: any) => ({
    id: row.id,
    title: row.title || 'Untitled',
    provider: row.provider || 'unknown',
    model: row.model,
    mode: row.mode,
    // Ensure workspaceId is never null/undefined for Y.js sync compatibility
    // NULL workspace_id means session was created before workspace tracking
    workspaceId: row.workspace_id || 'default',
    workspacePath: row.workspace_id || 'default', // workspace_id is the path in this system
    // NOTE: Do NOT include draftInput in bulk sync - it should only sync when actually changed
    // Including it here causes spurious metadata_updated events for all sessions on startup
    messageCount: parseInt(row.message_count) || 0,
    updatedAt: toMillis(row.updated_at),
    createdAt: toMillis(row.created_at),
    messages: undefined as SyncedMessage[] | undefined,
  }));

  // Optionally fetch messages for each session (include hidden - mobile filters client-side)
  if (includeMessages) {
    for (const session of sessions) {
      const { rows: msgRows } = await moduleDb.query<any>(
        `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
         FROM ai_agent_messages
         WHERE session_id = $1
         ORDER BY created_at ASC`,
        [session.id]
      );
      session.messages = msgRows.map((m: any): AgentMessage => ({
        id: m.id,
        sessionId: m.session_id,
        createdAt: m.created_at instanceof Date ? m.created_at : new Date(toMillis(m.created_at)),
        source: m.source,
        direction: m.direction,
        content: m.content,
        metadata: m.metadata,
        hidden: m.hidden ?? false,
      }));
    }
  }

  const totalTime = performance.now() - startTime;
  console.log(`[PGLiteSessionStore] getAllSessionsForSync() - ensureReady: ${ensureTime.toFixed(1)}ms, query: ${queryTime.toFixed(1)}ms, total: ${totalTime.toFixed(1)}ms, rows: ${rows.length}`);
  return sessions;
}

/**
 * Get messages for a session, optionally starting from an offset.
 * Used for delta sync - only fetch messages the server doesn't have.
 */
export async function getSessionMessagesForSync(
  sessionId: string,
  offset: number = 0
): Promise<SyncedMessage[]> {
  if (!moduleDb) {
    throw new Error('Session store not initialized');
  }
  if (moduleEnsureReady) {
    await moduleEnsureReady();
  }

  const { rows: msgRows } = await moduleDb.query<any>(
    `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
     FROM ai_agent_messages
     WHERE session_id = $1
     ORDER BY created_at ASC
     OFFSET $2`,
    [sessionId, offset]
  );

  return msgRows.map((m: any): AgentMessage => ({
    id: m.id,
    sessionId: m.session_id,
    createdAt: m.created_at instanceof Date ? m.created_at : new Date(toMillis(m.created_at)),
    source: m.source,
    direction: m.direction,
    content: m.content,
    metadata: m.metadata,
    hidden: m.hidden ?? false,
  }));
}

export function createPGLiteSessionStore(db: PGliteLike, ensureDbReady?: EnsureReadyFn): SessionStore {
  // Store db reference for module-level functions
  moduleDb = db;
  moduleEnsureReady = ensureDbReady ?? null;
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
      const createdAtMs = payload.createdAt ?? now;
      const updatedAtMs = payload.updatedAt ?? now;

      // Convert epoch milliseconds to Date objects
      // PostgreSQL will handle these correctly without timezone conversion issues
      const createdAt = new Date(createdAtMs);
      const updatedAt = new Date(updatedAtMs);

      // TODO: Debug logging - uncomment if needed
      // console.log('[PGLiteSessionStore] Creating session:', {
      //   id: payload.id,
      //   workspaceId: payload.workspaceId,
      //   provider: payload.provider,
      //   sessionType: (payload as any).sessionType
      // });

      await db.query(
        `INSERT INTO ai_sessions (
          id, workspace_id, file_path, provider, model, title, session_type, mode,
          document_context, provider_config, provider_session_id, draft_input, metadata,
          has_been_named, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15, $16
        )
        ON CONFLICT (id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          file_path = EXCLUDED.file_path,
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          title = EXCLUDED.title,
          session_type = EXCLUDED.session_type,
          mode = EXCLUDED.mode,
          document_context = EXCLUDED.document_context,
          provider_config = EXCLUDED.provider_config,
          provider_session_id = EXCLUDED.provider_session_id,
          draft_input = EXCLUDED.draft_input,
          metadata = EXCLUDED.metadata,
          has_been_named = EXCLUDED.has_been_named,
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
          (payload as any).mode ?? 'agent',
          payload.documentContext ?? null,
          payload.providerConfig ?? null,
          payload.providerSessionId ?? null,
          null,
          (payload as any).metadata ?? {},
          (payload as any).hasBeenNamed ?? false,
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
      if ((metadata as any).mode !== undefined) pushUpdate('mode =', (metadata as any).mode);
      if (metadata.workspaceId !== undefined) pushUpdate('workspace_id =', metadata.workspaceId);
      if (metadata.filePath !== undefined) pushUpdate('file_path =', metadata.filePath ?? null);
      if (metadata.providerConfig !== undefined) pushUpdate('provider_config =', metadata.providerConfig ?? null);
      if (metadata.providerSessionId !== undefined) pushUpdate('provider_session_id =', metadata.providerSessionId ?? null);
      if (metadata.documentContext !== undefined) pushUpdate('document_context =', metadata.documentContext ?? null);
      if (metadata.draftInput !== undefined) pushUpdate('draft_input =', metadata.draftInput ?? null);
      // NOTE: tokenUsage removed - it's derived from ai_agent_messages /context responses
      // NOTE: queuedPrompts removed - now uses separate queued_prompts table for atomic operations
      // Handle metadata field (the JSON blob) - do a shallow merge
      if ((metadata as any).metadata !== undefined) {
        updates.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${values.length + 1}::jsonb`);
        values.push(JSON.stringify((metadata as any).metadata));
      }
      if ((metadata as any).hasBeenNamed !== undefined) pushUpdate('has_been_named =', (metadata as any).hasBeenNamed);
      if (metadata.isArchived !== undefined) pushUpdate('is_archived =', metadata.isArchived);

      // NOTE: We intentionally do NOT update updated_at here. The updated_at timestamp
      // should only change when messages are added (via PGLiteAgentMessagesStore.create),
      // so that session history sorting accurately reflects the last message time.
      if (!updates.length) {
        // Nothing to update - no-op
        return;
      }

      const setClause = updates.join(', ');
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
        mode: row.mode ?? undefined,
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
        hasBeenNamed: row.has_been_named ?? false,
      } satisfies ChatSession;
    },

    async list(workspaceId: string, options?: SessionListOptions): Promise<SessionListItem[]> {
      const startTime = performance.now();
      await ensureReady();
      const ensureTime = performance.now() - startTime;
      const includeArchived = options?.includeArchived ?? false;
      const archiveFilter = includeArchived ? '' : 'AND (s.is_archived = FALSE OR s.is_archived IS NULL)';

      const queryStart = performance.now();
      const { rows } = await db.query<any>(
        `SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                s.created_at, s.updated_at, s.is_archived, COUNT(m.id) as message_count
         FROM ai_sessions s
         LEFT JOIN ai_agent_messages m ON s.id = m.session_id AND m.direction = 'input'
         WHERE s.workspace_id=$1 ${archiveFilter}
         GROUP BY s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                  s.created_at, s.updated_at, s.is_archived
         ORDER BY s.updated_at DESC`,
        [workspaceId]
      );
      const queryTime = performance.now() - queryStart;
      const totalTime = performance.now() - startTime;
      console.log(`[PGLiteSessionStore] list() - ensureReady: ${ensureTime.toFixed(1)}ms, query: ${queryTime.toFixed(1)}ms, total: ${totalTime.toFixed(1)}ms, rows: ${rows.length}`);
      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        const messageCount = parseInt(row.message_count) || 0;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type ?? undefined,
          mode: row.mode ?? undefined,
          title: row.title ?? undefined,
          workspaceId: row.workspace_id,
          createdAt,
          updatedAt,
          messageCount,
          isArchived: row.is_archived ?? false,
        };
      });
    },

    async search(workspaceId: string, query: string, options?: SessionListOptions): Promise<SessionListItem[]> {
      await ensureReady();

      // If query is empty, return all sessions (same as list)
      if (!query || query.trim().length === 0) {
        return this.list(workspaceId, options);
      }

      const includeArchived = options?.includeArchived ?? false;
      const archiveFilter = includeArchived ? '' : 'AND (s.is_archived = FALSE OR s.is_archived IS NULL)';

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
            s.mode,
            s.title,
            s.workspace_id,
            s.created_at,
            s.updated_at,
            s.is_archived,
            ts_rank_cd(to_tsvector('english', COALESCE(s.title, '')), to_tsquery('english', $2)) * 2 as rank
          FROM ai_sessions s
          WHERE s.workspace_id = $1
            AND to_tsvector('english', COALESCE(s.title, '')) @@ to_tsquery('english', $2)
            ${archiveFilter}

          UNION

          -- Search in message content
          SELECT DISTINCT
            s.id,
            s.provider,
            s.model,
            s.session_type,
            s.mode,
            s.title,
            s.workspace_id,
            s.created_at,
            s.updated_at,
            s.is_archived,
            MAX(ts_rank_cd(to_tsvector('english', m.content), to_tsquery('english', $2))) as rank
          FROM ai_sessions s
          INNER JOIN ai_agent_messages m ON s.id = m.session_id
          WHERE s.workspace_id = $1
            AND to_tsvector('english', m.content) @@ to_tsquery('english', $2)
            ${archiveFilter}
          GROUP BY s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                   s.created_at, s.updated_at, s.is_archived
        )
        SELECT
          sm.id,
          sm.provider,
          sm.model,
          sm.session_type,
          sm.mode,
          sm.title,
          sm.workspace_id,
          sm.created_at,
          sm.updated_at,
          sm.is_archived,
          MAX(sm.rank) as max_rank,
          COUNT(m.id) as message_count
        FROM session_matches sm
        LEFT JOIN ai_agent_messages m ON sm.id = m.session_id AND m.direction = 'input'
        GROUP BY sm.id, sm.provider, sm.model, sm.session_type, sm.mode, sm.title, sm.workspace_id,
                 sm.created_at, sm.updated_at, sm.is_archived
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
          mode: row.mode ?? undefined,
          title: row.title ?? undefined,
          workspaceId: row.workspace_id,
          createdAt,
          updatedAt,
          messageCount,
          isArchived: row.is_archived ?? false,
        };
      });
    },

    async delete(sessionId: string): Promise<void> {
      await ensureReady();
      await db.query('DELETE FROM ai_sessions WHERE id=$1', [sessionId]);
    },

    async updateTitleIfNotNamed(sessionId: string, title: string): Promise<boolean> {
      await ensureReady();
      // NOTE: We intentionally do NOT update updated_at here. The updated_at timestamp
      // should only change when messages are added, so session history sorting
      // accurately reflects the last message time.
      const { rows } = await db.query<{ affected_rows: number }>(
        `UPDATE ai_sessions
         SET title = $2, has_been_named = true
         WHERE id = $1 AND (has_been_named = false OR has_been_named IS NULL)
         RETURNING 1 as affected_rows`,
        [sessionId, title]
      );
      return rows.length > 0;
    },

    // Note: claimQueuedPrompt has been moved to the new queued_prompts table
    // See PGLiteQueuedPromptsStore.ts for the new implementation
  };
}

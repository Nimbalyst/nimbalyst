/**
 * PGLite implementation of SessionStore interface from runtime package
 */

import type {
  SessionStore,
  SessionMeta,
  SessionListOptions,
  SessionSearchOptions,
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

  // With TIMESTAMPTZ columns, PGLite returns Date objects that already represent
  // the correct instant in time. Just call getTime() to get epoch milliseconds.
  if (value instanceof Date) {
    return value.getTime();
  }

  // Fallback for string timestamps (shouldn't happen with TIMESTAMPTZ, but just in case)
  const str = String(value).trim();
  // Detect timezone: ends with Z, contains +, or has negative offset like -05:00
  const hasTimezone = str.endsWith('Z') || str.includes('+') || /-\d{2}:\d{2}$/.test(str);
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
  sessionType?: string;
  workspaceId?: string;
  workspacePath?: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  metadata?: Record<string, any>;
  messages?: SyncedMessage[];
}>> {
  // Log stack trace to identify callers
  // const stack = new Error().stack?.split('\n').slice(1, 5).join('\n') || 'no stack';
  // console.log('[PGLiteSessionStore] getAllSessionsForSync called from:\n' + stack);

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
    `SELECT s.id, s.provider, s.model, s.mode, s.session_type, s.title, s.workspace_id, s.draft_input,
            s.created_at, s.updated_at, s.metadata, COUNT(m.id) as message_count
     FROM ai_sessions s
     LEFT JOIN ai_agent_messages m ON s.id = m.session_id AND m.direction = 'input' AND (m.hidden = FALSE OR m.hidden IS NULL)
     WHERE (s.is_archived = FALSE OR s.is_archived IS NULL)
     GROUP BY s.id, s.provider, s.model, s.mode, s.session_type, s.title, s.workspace_id, s.draft_input, s.created_at, s.updated_at, s.metadata
     ORDER BY s.updated_at DESC`
  );
  const queryTime = performance.now() - queryStart;

  // Filter out sessions without workspace_id - they are legacy data that cannot be routed correctly
  // Do NOT fall back to 'default' as that masks the real issue (missing workspace tracking)
  const validRows = rows.filter((row: any) => {
    if (!row.workspace_id) {
      console.warn(`[PGLiteSessionStore] Skipping session ${row.id} - missing workspace_id (legacy data)`);
      return false;
    }
    return true;
  });

  const sessions = validRows.map((row: any) => {
    return {
      id: row.id,
      title: row.title || 'Untitled',
      provider: row.provider || 'unknown',
      model: row.model,
      mode: row.mode,
      sessionType: row.session_type || 'session',
      // workspace_id is required - we filtered out sessions without it above
      workspaceId: row.workspace_id,
      workspacePath: row.workspace_id, // workspace_id is the path in this system
      // NOTE: Do NOT include draftInput in bulk sync - it should only sync when actually changed
      // Including it here causes spurious metadata_updated events for all sessions on startup
      messageCount: parseInt(row.message_count) || 0,
      updatedAt: toMillis(row.updated_at),
      createdAt: toMillis(row.created_at),
      metadata: row.metadata,
      messages: undefined as SyncedMessage[] | undefined,
    };
  });

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

  // const totalTime = performance.now() - startTime;
  // console.log(`[PGLiteSessionStore] getAllSessionsForSync() - ensureReady: ${ensureTime.toFixed(1)}ms, query: ${queryTime.toFixed(1)}ms, total: ${totalTime.toFixed(1)}ms, rows: ${rows.length}`);
  return sessions;
}

/**
 * Get messages for a session created after a given timestamp.
 * Used for delta sync - only fetch messages newer than the server's last sync.
 *
 * @param sessionId The session ID
 * @param sinceTimestamp Epoch milliseconds - only return messages created AFTER this time (0 = all)
 */
export async function getSessionMessagesForSync(
  sessionId: string,
  sinceTimestamp: number = 0
): Promise<SyncedMessage[]> {
  if (!moduleDb) {
    throw new Error('Session store not initialized');
  }
  if (moduleEnsureReady) {
    await moduleEnsureReady();
  }

  // Convert milliseconds to Date for PostgreSQL comparison
  const sinceDate = new Date(sinceTimestamp);

  const { rows: msgRows } = await moduleDb.query<any>(
    `SELECT id, session_id, created_at, source, direction, content, metadata, hidden
     FROM ai_agent_messages
     WHERE session_id = $1 AND created_at > $2
     ORDER BY created_at ASC`,
    [sessionId, sinceDate]
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
      // TIMESTAMPTZ columns handle Date objects correctly
      const createdAt = new Date(createdAtMs);
      const updatedAt = new Date(updatedAtMs);

      const branchedAt = (payload as any).branchedAt ? new Date((payload as any).branchedAt) : null;

      await db.query(
        `INSERT INTO ai_sessions (
          id, workspace_id, file_path, worktree_id, parent_session_id, provider, model, title, session_type, mode,
          document_context, provider_config, provider_session_id, draft_input, metadata,
          has_been_named, created_at, updated_at,
          branched_from_session_id, branch_point_message_id, branched_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18,
          $19, $20, $21
        )
        ON CONFLICT (id) DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          file_path = EXCLUDED.file_path,
          worktree_id = EXCLUDED.worktree_id,
          parent_session_id = EXCLUDED.parent_session_id,
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
          updated_at = EXCLUDED.updated_at,
          branched_from_session_id = EXCLUDED.branched_from_session_id,
          branch_point_message_id = EXCLUDED.branch_point_message_id,
          branched_at = EXCLUDED.branched_at
      `,
        [
          payload.id,
          payload.workspaceId,
          payload.filePath ?? null,
          (payload as any).worktreeId ?? null,
          payload.parentSessionId ?? null,  // Parent session ID for hierarchical workstreams
          payload.provider,
          payload.model ?? null,
          payload.title ?? 'New conversation',
          (payload as any).sessionType ?? 'session',
          (payload as any).mode ?? 'agent',
          payload.documentContext ?? null,
          payload.providerConfig ?? null,
          payload.providerSessionId ?? null,
          null,
          (payload as any).metadata ?? {},
          (payload as any).hasBeenNamed ?? false,
          createdAt,
          updatedAt,
          (payload as any).branchedFromSessionId ?? null,  // Branch tracking - separate from parent
          (payload as any).branchPointMessageId ?? null,
          branchedAt,
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
      if ((metadata as any).isPinned !== undefined) pushUpdate('is_pinned =', (metadata as any).isPinned);
      if ((metadata as any).parentSessionId !== undefined) pushUpdate('parent_session_id =', (metadata as any).parentSessionId);
      if ((metadata as any).lastDocumentState !== undefined) pushUpdate('last_document_state =', (metadata as any).lastDocumentState);

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
        `SELECT s.*,
         EXTRACT(EPOCH FROM s.last_read_timestamp) * 1000 AS last_read_ms,
         w.path AS worktree_path,
         w.workspace_id AS worktree_project_path,
         branched_from.provider_session_id AS branched_from_provider_session_id
         FROM ai_sessions s
         LEFT JOIN worktrees w ON s.worktree_id = w.id
         LEFT JOIN ai_sessions branched_from ON s.branched_from_session_id = branched_from.id
         WHERE s.id=$1 LIMIT 1`,
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
        worktreeId: row.worktree_id ?? undefined,
        worktreePath: row.worktree_path ?? undefined,
        worktreeProjectPath: row.worktree_project_path ?? undefined,
        parentSessionId: row.parent_session_id ?? null,  // Hierarchical workstream support
        createdAt: toMillis(row.created_at),
        updatedAt: toMillis(row.updated_at),
        metadata,
        documentContext: row.document_context ?? undefined,
        providerConfig: row.provider_config ?? undefined,
        providerSessionId: row.provider_session_id ?? undefined,
        lastReadMessageTimestamp: row.last_read_ms ? Number(row.last_read_ms) : undefined,
        hasBeenNamed: row.has_been_named ?? false,
        isArchived: row.is_archived ?? false,
        isPinned: row.is_pinned ?? false,
        // Branch tracking fields - SEPARATE from hierarchical parentSessionId
        branchedFromSessionId: row.branched_from_session_id ?? undefined,
        branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
        branchedAt: row.branched_at ? toMillis(row.branched_at) : undefined,
        branchedFromProviderSessionId: row.branched_from_provider_session_id ?? undefined,
        // Document context service state for transition detection
        lastDocumentState: row.last_document_state ?? undefined,
      } satisfies ChatSession;
    },

    async getMany(sessionIds: string[]): Promise<ChatSession[]> {
      if (sessionIds.length === 0) return [];
      await ensureReady();

      // Use ANY($1::text[]) for batch query - much more efficient than N individual queries
      const { rows } = await db.query<any>(
        `SELECT s.*,
         EXTRACT(EPOCH FROM s.last_read_timestamp) * 1000 AS last_read_ms,
         w.path AS worktree_path,
         w.workspace_id AS worktree_project_path,
         branched_from.provider_session_id AS branched_from_provider_session_id
         FROM ai_sessions s
         LEFT JOIN worktrees w ON s.worktree_id = w.id
         LEFT JOIN ai_sessions branched_from ON s.branched_from_session_id = branched_from.id
         WHERE s.id = ANY($1::text[])`,
        [sessionIds]
      );

      return rows.map((row: any) => {
        const metadata = row.metadata ?? {};
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type ?? undefined,
          mode: row.mode ?? undefined,
          title: row.title ?? undefined,
          draftInput: row.draft_input ?? undefined,
          messages: [],
          workspacePath: row.workspace_id,
          worktreeId: row.worktree_id ?? undefined,
          worktreePath: row.worktree_path ?? undefined,
          worktreeProjectPath: row.worktree_project_path ?? undefined,
          parentSessionId: row.parent_session_id ?? null,
          createdAt: toMillis(row.created_at),
          updatedAt: toMillis(row.updated_at),
          metadata,
          documentContext: row.document_context ?? undefined,
          providerConfig: row.provider_config ?? undefined,
          providerSessionId: row.provider_session_id ?? undefined,
          lastReadMessageTimestamp: row.last_read_ms ? Number(row.last_read_ms) : undefined,
          hasBeenNamed: row.has_been_named ?? false,
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt: row.branched_at ? toMillis(row.branched_at) : undefined,
          branchedFromProviderSessionId: row.branched_from_provider_session_id ?? undefined,
        } satisfies ChatSession;
      });
    },

    async list(workspaceId: string, options?: SessionListOptions): Promise<SessionMeta[]> {
      const startTime = performance.now();
      await ensureReady();
      const ensureTime = performance.now() - startTime;
      const includeArchived = options?.includeArchived ?? false;
      const archiveFilter = includeArchived ? '' : 'AND (s.is_archived = FALSE OR s.is_archived IS NULL)';

      const queryStart = performance.now();
      // Query includes parent_session_id and child_count for hierarchical session support
      // child_count is calculated via a correlated subquery for sessions that have children
      // branched_from_session_id is separate from parent_session_id (branch vs hierarchy)
      // metadata is included for hasUnread state (transient UI state stored in DB for cross-device sync)
      // NOTE: message_count removed - it required an expensive LEFT JOIN on ai_agent_messages
      // that was slow with many sessions. The count is not essential for the list view.
      const { rows } = await db.query<any>(
        `SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                s.branched_from_session_id, s.branch_point_message_id, s.branched_at, s.metadata,
                (SELECT COUNT(*) FROM ai_sessions c WHERE c.parent_session_id = s.id) as child_count
         FROM ai_sessions s
         WHERE s.workspace_id=$1 ${archiveFilter}
         ORDER BY s.updated_at DESC`,
        [workspaceId]
      );
      const queryTime = performance.now() - queryStart;
      const totalTime = performance.now() - startTime;
      // console.log(`[PGLiteSessionStore] list() - ensureReady: ${ensureTime.toFixed(1)}ms, query: ${queryTime.toFixed(1)}ms, total: ${totalTime.toFixed(1)}ms, rows: ${rows.length}`);
      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        const branchedAt = row.branched_at ? toMillis(row.branched_at) : undefined;
        const childCount = parseInt(row.child_count) || 0;
        const metadata = row.metadata ?? {};
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type || 'session',
          mode: row.mode ?? undefined,
          title: row.title || 'Untitled Session',
          workspaceId: row.workspace_id,
          worktreeId: row.worktree_id ?? null,
          parentSessionId: row.parent_session_id ?? null,
          childCount,
          uncommittedCount: 0,
          createdAt,
          updatedAt,
          messageCount: 0,  // Not computed in list query for performance - loaded lazily if needed
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          // Branch tracking - SEPARATE from hierarchical parentSessionId
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt,
          hasUnread: metadata.metadata?.hasUnread ?? metadata.hasUnread ?? false,
          // Check if session has a pending AskUserQuestion (for sidebar indicator persistence)
          hasPendingQuestion: !!(metadata.pendingAskUserQuestion),
        } satisfies SessionMeta & { hasPendingQuestion?: boolean };
      });
    },

    async search(workspaceId: string, query: string, options?: SessionSearchOptions): Promise<SessionMeta[]> {
      await ensureReady();

      // If query is empty, return all sessions (same as list)
      if (!query || query.trim().length === 0) {
        return this.list(workspaceId, options);
      }

      const includeArchived = options?.includeArchived ?? false;
      const archiveFilter = includeArchived ? '' : 'AND (s.is_archived = FALSE OR s.is_archived IS NULL)';

      // Default to 30 days to reduce database load
      const timeRange = options?.timeRange ?? '30d';
      const direction = options?.direction ?? 'all';

      // Sanitize query for FTS - replace special characters and prepare for tsquery
      const searchTerms = query.trim().split(/\s+/).filter(Boolean).join(' & ');

      // Calculate cutoff date for time range filter
      let cutoffDate: Date | null = null;
      if (timeRange !== 'all') {
        const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
        const days = daysMap[timeRange];
        cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
      }

      // Run two separate queries and union in memory for better performance
      // This allows each query to use indexes more efficiently

      // Query 1: Search session titles (fast)
      const titleQuery = db.query<any>(
        `SELECT
          s.id,
          s.provider,
          s.model,
          s.session_type,
          s.mode,
          s.title,
          s.workspace_id,
          s.worktree_id,
          s.parent_session_id,
          s.created_at,
          s.updated_at,
          s.is_archived,
          s.is_pinned,
          s.branched_from_session_id,
          s.branch_point_message_id,
          s.branched_at,
          ts_rank_cd(to_tsvector('english', COALESCE(s.title, '')), to_tsquery('english', $2)) * 2 as rank,
          (SELECT COUNT(*) FROM ai_sessions c WHERE c.parent_session_id = s.id) as child_count
        FROM ai_sessions s
        WHERE s.workspace_id = $1
          AND to_tsvector('english', COALESCE(s.title, '')) @@ to_tsquery('english', $2)
          ${archiveFilter}`,
        [workspaceId, searchTerms]
      );

      // Query 2: Search message content (uses GIN index on searchable messages)
      // Only returns session IDs that match - we'll join with session data in memory
      // Includes time range and direction filters to reduce database load
      const contentQueryParams: any[] = [searchTerms];
      let contentQuerySql = `SELECT DISTINCT m.session_id,
          MAX(ts_rank_cd(to_tsvector('english', m.content), to_tsquery('english', $1))) as rank
        FROM ai_agent_messages m
        WHERE m.searchable = true
          AND to_tsvector('english', m.content) @@ to_tsquery('english', $1)`;

      if (cutoffDate) {
        contentQueryParams.push(cutoffDate);
        contentQuerySql += ` AND m.created_at >= $${contentQueryParams.length}`;
      }

      if (direction !== 'all') {
        contentQueryParams.push(direction);
        contentQuerySql += ` AND m.direction = $${contentQueryParams.length}`;
      }

      contentQuerySql += ' GROUP BY m.session_id';

      const contentQuery = db.query<any>(contentQuerySql, contentQueryParams);

      // Run both queries in parallel
      const [titleResult, contentResult] = await Promise.all([titleQuery, contentQuery]);

      // Build a map of session ID -> best rank from both sources
      const sessionRanks = new Map<string, number>();
      const sessionRows = new Map<string, any>();

      // Add title matches
      for (const row of titleResult.rows) {
        sessionRanks.set(row.id, row.rank);
        sessionRows.set(row.id, row);
      }

      // Get content match session IDs that aren't already in title results
      const contentSessionIds = contentResult.rows
        .map((r: any) => r.session_id)
        .filter((id: string) => !sessionRows.has(id));

      // If we have content matches not in title results, fetch their session data
      if (contentSessionIds.length > 0) {
        const { rows: contentSessions } = await db.query<any>(
          `SELECT
            s.id,
            s.provider,
            s.model,
            s.session_type,
            s.mode,
            s.title,
            s.workspace_id,
            s.worktree_id,
            s.parent_session_id,
            s.created_at,
            s.updated_at,
            s.is_archived,
            s.is_pinned,
            s.branched_from_session_id,
            s.branch_point_message_id,
            s.branched_at,
            (SELECT COUNT(*) FROM ai_sessions c WHERE c.parent_session_id = s.id) as child_count
          FROM ai_sessions s
          WHERE s.id = ANY($1)
            AND s.workspace_id = $2
            ${archiveFilter}`,
          [contentSessionIds, workspaceId]
        );

        // Add content matches with their ranks
        const contentRankMap = new Map(contentResult.rows.map((r: any) => [r.session_id, r.rank]));
        for (const row of contentSessions) {
          const contentRank = contentRankMap.get(row.id) || 0;
          const existingRank = sessionRanks.get(row.id) || 0;
          sessionRanks.set(row.id, Math.max(existingRank, contentRank));
          if (!sessionRows.has(row.id)) {
            sessionRows.set(row.id, { ...row, rank: contentRank });
          }
        }
      }

      // Also update ranks for sessions found in both title and content
      for (const contentRow of contentResult.rows) {
        if (sessionRows.has(contentRow.session_id)) {
          const existingRank = sessionRanks.get(contentRow.session_id) || 0;
          sessionRanks.set(contentRow.session_id, Math.max(existingRank, contentRow.rank));
        }
      }

      // Convert to array and sort by rank DESC, updated_at DESC
      const rows = Array.from(sessionRows.values())
        .map(row => ({ ...row, max_rank: sessionRanks.get(row.id) || row.rank }))
        .sort((a, b) => {
          if (b.max_rank !== a.max_rank) return b.max_rank - a.max_rank;
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        });

      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        const branchedAt = row.branched_at ? toMillis(row.branched_at) : undefined;
        const childCount = parseInt(row.child_count) || 0;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type || 'session',
          mode: row.mode ?? undefined,
          title: row.title || 'Untitled Session',
          workspaceId: row.workspace_id,
          worktreeId: row.worktree_id ?? null,
          parentSessionId: row.parent_session_id ?? null,
          childCount,
          uncommittedCount: 0,
          createdAt,
          updatedAt,
          messageCount: 0,  // Not computed in search query for performance
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt,
        } satisfies SessionMeta;
      });
    },

    async getBranches(sessionId: string): Promise<SessionMeta[]> {
      await ensureReady();
      // Find all sessions that were branched FROM this session (not hierarchical children)
      const { rows } = await db.query<any>(
        `SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                s.branched_from_session_id, s.branch_point_message_id, s.branched_at, COUNT(m.id) as message_count
         FROM ai_sessions s
         LEFT JOIN ai_agent_messages m ON s.id = m.session_id AND m.direction = 'input' AND (m.hidden = FALSE OR m.hidden IS NULL)
         WHERE s.branched_from_session_id=$1
         GROUP BY s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                  s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                  s.branched_from_session_id, s.branch_point_message_id, s.branched_at
         ORDER BY s.branched_at DESC`,
        [sessionId]
      );
      return rows.map(row => {
        const createdAt = toMillis(row.created_at);
        const updatedAt = toMillis(row.updated_at);
        const branchedAt = row.branched_at ? toMillis(row.branched_at) : undefined;
        const messageCount = parseInt(row.message_count) || 0;
        return {
          id: row.id,
          provider: row.provider,
          model: row.model ?? undefined,
          sessionType: row.session_type || 'session',
          mode: row.mode ?? undefined,
          title: row.title || 'Untitled Session',
          workspaceId: row.workspace_id,
          worktreeId: row.worktree_id ?? null,
          parentSessionId: row.parent_session_id ?? null,
          childCount: 0,  // Not computed in branch query
          uncommittedCount: 0,
          createdAt,
          updatedAt,
          messageCount,
          isArchived: row.is_archived ?? false,
          isPinned: row.is_pinned ?? false,
          branchedFromSessionId: row.branched_from_session_id ?? undefined,
          branchPointMessageId: row.branch_point_message_id ? parseInt(row.branch_point_message_id) : undefined,
          branchedAt,
        } satisfies SessionMeta;
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

import { SessionManager } from '@nimbalyst/runtime/ai/server';
import { AISessionsRepository } from '@nimbalyst/runtime';
import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import path from "path";
import { safeHandle, safeOn } from '../utils/ipcRegistry';

// Initialize session manager
const sessionManager = new SessionManager();

// Track if handlers are registered to prevent double registration
let handlersRegistered = false;

export async function registerSessionHandlers() {
    if (handlersRegistered) {
        console.log('[SessionHandlers] Handlers already registered, skipping');
        return;
    }

    // Initialize session manager
    await sessionManager.initialize();

    // Create session
    safeHandle('session:create', async (event, filePath: string, type: string, source?: any) => {
        const documentContext = filePath ? { content: '', filePath } : undefined;
        return await sessionManager.createSession(type as any, documentContext, source);
    });

    // Create session (new format for agentic coding)
    safeHandle('sessions:create', async (event, payload: { session: any; workspaceId: string }) => {
        try {
            const { session, workspaceId } = payload;

            const createPayload = {
                id: session.id,
                provider: session.provider,
                model: session.model,
                title: session.title || 'Untitled',
                workspaceId: workspaceId,
                providerConfig: session.providerConfig,
                providerSessionId: session.providerSessionId,
                worktreeId: session.worktreeId || null
            };
            console.log('[SessionHandlers] Creating session with payload:', JSON.stringify(createPayload));

            await AISessionsRepository.create(createPayload);

            // Update with full metadata
            if (session.metadata) {
                await AISessionsRepository.updateMetadata(session.id, { metadata: session.metadata });
            }

            return { success: true, id: session.id };
        } catch (error) {
            console.error('[SessionHandlers] Error creating session:', error);
            return { success: false, error: String(error) };
        }
    });

    handlersRegistered = true;

    // Load session
    safeHandle('session:load', async (event, sessionId: string) => {
        return await sessionManager.loadSession(sessionId);
    });

    // Save session - maps to updateSessionMessages
    safeHandle('session:save', async (event, session: any) => {
        if (session?.id && session?.messages) {
            await sessionManager.updateSessionMessages(session.id, session.messages);
        }
    });

    // Delete session
    safeHandle('session:delete', async (event, sessionId: string) => {
        await sessionManager.deleteSession(sessionId);
    });

    // Update session title
    safeHandle('sessions:update-title', async (event, sessionId: string, title: string) => {
        await sessionManager.updateSessionTitle(sessionId, title, {
            force: true,
            markAsNamed: true,
        });
    });

    // Update session model
    safeHandle('sessions:update-model', async (event, sessionId: string, model: string) => {
        await sessionManager.updateSessionModel(sessionId, model);
    });

    // Update session provider and model (when switching between providers)
    safeHandle('sessions:update-provider-and-model', async (event, sessionId: string, provider: string, model: string) => {
        await sessionManager.updateSessionProviderAndModel(sessionId, provider, model);
    });

    // Update session draft input
    safeHandle('sessions:update-draft-input', async (event, sessionId: string, draftInput: string) => {
        await sessionManager.updateSessionDraftInput(sessionId, draftInput);
    });

    // Update session metadata (including mode, isArchived, etc.)
    safeHandle('sessions:update-metadata', async (event, sessionId: string, updates: any) => {
        try {
            await AISessionsRepository.updateMetadata(sessionId, updates);
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to update session metadata:', error);
            return { success: false, error: String(error) };
        }
    });

    // Update session metadata with extended fields
    safeHandle('sessions:update-session-metadata', async (event, sessionId: string, updates: any) => {
        try {
            // Extract sessionType and metadata from updates
            const { sessionType, ...metadataFields } = updates;

            // Build update payload
            const updatePayload: any = {};
            if (sessionType !== undefined) {
                updatePayload.sessionType = sessionType;
            }
            if (Object.keys(metadataFields).length > 0) {
                updatePayload.metadata = metadataFields;
            }

            await AISessionsRepository.updateMetadata(sessionId, updatePayload);

            // Notify all windows about the update
            const { BrowserWindow } = await import('electron');
            BrowserWindow.getAllWindows().forEach(window => {
                if (!window.isDestroyed()) {
                    window.webContents.send('sessions:session-updated', sessionId, metadataFields);
                }
            });

            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to update session metadata:', error);
            return { success: false, error: String(error) };
        }
    });

    // Branch a session
    safeHandle('sessions:branch', async (event, payload: {
        parentSessionId: string;
        branchPointMessageId?: number;
        workspacePath?: string;
    }) => {
        try {
            const { parentSessionId, branchPointMessageId, workspacePath } = payload;
            const branchedSession = await sessionManager.branchSession(
                parentSessionId,
                branchPointMessageId,
                workspacePath
            );

            // Notify all windows about the new branch
            const { BrowserWindow } = await import('electron');
            BrowserWindow.getAllWindows().forEach(window => {
                if (!window.isDestroyed()) {
                    window.webContents.send('sessions:session-created', branchedSession);
                }
            });

            return { success: true, session: branchedSession };
        } catch (error) {
            console.error('[SessionHandlers] Failed to branch session:', error);
            return { success: false, error: String(error) };
        }
    });

    // Get branches for a session
    safeHandle('sessions:get-branches', async (event, sessionId: string) => {
        try {
            const branches = await AISessionsRepository.getBranches(sessionId);
            return { success: true, branches };
        } catch (error) {
            console.error('[SessionHandlers] Failed to get session branches:', error);
            return { success: false, error: String(error) };
        }
    });

    // List sessions for workspace
    safeHandle('sessions:list', async (event, workspacePath: string, options?: { includeArchived?: boolean }) => {
        try {
            const startTime = performance.now();
            const entries = await AISessionsRepository.list(workspacePath, options);
            const listTime = performance.now() - startTime;
            // console.log(`[SessionHandlers] sessions:list query took ${listTime.toFixed(1)}ms for ${entries.length} sessions`);

            // Get uncommitted file counts for all sessions
            // Count files edited by each session that are currently uncommitted in git
            const uncommittedMap = new Map<string, number>();
            try {
                const simpleGit = (await import('simple-git')).default;
                const git = simpleGit(workspacePath);
                const status = await git.status();

                // Get all currently uncommitted files (modified, staged, or untracked)
                const uncommittedFiles = new Set([
                    ...status.modified,
                    ...status.created,
                    ...status.not_added,
                    ...status.deleted,
                    ...status.renamed.map(r => r.to),
                    ...status.staged
                ]);

                if (uncommittedFiles.size > 0) {
                    const { database } = await import('../database/PGLiteDatabaseWorker');

                    // Get the MOST RECENT session that edited each file
                    // This ensures we only count a file for the session that last touched it
                    const { rows: sessionFiles } = await database.query<{ session_id: string; file_path: string; timestamp: string }>(
                        `SELECT DISTINCT ON (file_path) session_id, file_path, timestamp
                         FROM session_files
                         WHERE workspace_id = $1 AND link_type = 'edited'
                         ORDER BY file_path, timestamp DESC`,
                        [workspacePath]
                    );

                    // Count uncommitted files per session (only for the session that last edited each file)
                    sessionFiles.forEach(row => {
                        const relativePath = row.file_path.replace(workspacePath + '/', '');
                        if (uncommittedFiles.has(relativePath)) {
                            uncommittedMap.set(row.session_id, (uncommittedMap.get(row.session_id) || 0) + 1);
                        }
                    });
                }
            } catch (error) {
                console.error('[SessionHandlers] Failed to get uncommitted counts:', error);
            }

            // Use entry data directly - it already has all the info we need including updatedAt
            const sessions = entries.map(entry => {
                const uncommittedCount = uncommittedMap.get(entry.id) || 0;
                return {
                    id: entry.id,
                    createdAt: entry.createdAt,
                    updatedAt: entry.updatedAt,
                    name: entry.title,
                    title: entry.title,
                    provider: entry.provider,
                    model: entry.model,
                    sessionType: entry.sessionType || 'chat',
                    messageCount: entry.messageCount || 0,
                    isArchived: entry.isArchived || false,
                    isPinned: (entry as any).isPinned || false,  // Include isPinned from repository
                    worktreeId: entry.worktreeId,  // Include worktreeId from repository
                    parentSessionId: entry.parentSessionId || null,  // Hierarchical workstream support
                    childCount: entry.childCount || 0,  // Number of child sessions
                    uncommittedCount,  // Number of uncommitted files
                    // Branch tracking - SEPARATE from hierarchical parentSessionId
                    branchedFromSessionId: (entry as any).branchedFromSessionId,
                    branchPointMessageId: entry.branchPointMessageId,
                    branchedAt: entry.branchedAt,
                    metadata: {}
                };
            });

            // Log a few sessions with their uncommitted counts for debugging
            const samplesWithCount = sessions.slice(0, 3).map(s => ({
                id: s.id.substring(0, 8),
                title: s.title?.substring(0, 30),
                uncommittedCount: s.uncommittedCount
            }));
            console.log(`[SessionHandlers] Returning ${sessions.length} sessions, first 3:`, JSON.stringify(samplesWithCount));

            return { success: true, sessions };
        } catch (error) {
            console.error('[SessionHandlers] Failed to list sessions:', error);
            return { success: false, error: String(error), sessions: [] };
        }
    });

    // List child sessions for a parent session
    safeHandle('sessions:list-children', async (event, parentSessionId: string, workspacePath: string) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            const { rows } = await database.query<any>(
                `SELECT s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                        s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned,
                        COUNT(m.id) as message_count
                 FROM ai_sessions s
                 LEFT JOIN ai_agent_messages m ON s.id = m.session_id AND m.direction = 'input' AND (m.hidden = FALSE OR m.hidden IS NULL)
                 WHERE s.parent_session_id = $1 AND s.workspace_id = $2
                 GROUP BY s.id, s.provider, s.model, s.session_type, s.mode, s.title, s.workspace_id,
                          s.worktree_id, s.parent_session_id, s.created_at, s.updated_at, s.is_archived, s.is_pinned
                 ORDER BY s.created_at ASC`,
                [parentSessionId, workspacePath]
            );

            const children = rows.map((row: any) => ({
                id: row.id,
                title: row.title || 'Untitled Session',
                provider: row.provider,
                model: row.model,
                createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
                updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : row.updated_at,
                messageCount: parseInt(row.message_count) || 0,
                parentSessionId: row.parent_session_id,
            }));

            return { success: true, children };
        } catch (error) {
            console.error('[SessionHandlers] Failed to list child sessions:', error);
            return { success: false, error: String(error), children: [] };
        }
    });

    // Create a child session under a parent
    safeHandle('sessions:create-child', async (event, payload: {
        parentSessionId: string;
        workspacePath: string;
        worktreeId?: string;
        provider?: string;
    }) => {
        console.log('[SessionHandlers] sessions:create-child called with:', JSON.stringify(payload));
        try {
            const { parentSessionId, workspacePath, worktreeId, provider = 'claude-code' } = payload;
            // Use crypto.randomUUID() instead of dynamic import to avoid bundling issues
            const sessionId = crypto.randomUUID();
            console.log(`[SessionHandlers] Creating child session ${sessionId} for parent ${parentSessionId}`);
            const createPayload = {
                id: sessionId,
                provider,
                title: 'New Session',
                workspaceId: workspacePath,
                parentSessionId,  // Link to parent
                worktreeId: worktreeId || null,  // Inherit from parent if provided
            };

            await AISessionsRepository.create(createPayload as any);
            console.log(`[SessionHandlers] Child session ${sessionId} created successfully`);

            return { success: true, sessionId };
        } catch (error) {
            console.error('[SessionHandlers] Failed to create child session:', error);
            return { success: false, error: String(error) };
        }
    });

    // Set parent for a session (reparent operation for drag-drop)
    safeHandle('sessions:set-parent', async (event, payload: {
        sessionId: string;
        newParentId: string | null;
        workspacePath: string;
    }) => {
        try {
            const { sessionId, newParentId, workspacePath } = payload;

            // Validate session exists
            const session = await AISessionsRepository.get(sessionId);
            if (!session) {
                return { success: false, error: 'Session not found' };
            }

            // Validate session belongs to the workspace
            if (session.workspacePath !== workspacePath) {
                return { success: false, error: 'Session does not belong to this workspace' };
            }

            // If setting a parent, validate the parent exists and is in same workspace
            if (newParentId) {
                const parent = await AISessionsRepository.get(newParentId);
                if (!parent) {
                    return { success: false, error: 'Parent session not found' };
                }
                if (parent.workspacePath !== workspacePath) {
                    return { success: false, error: 'Parent session is in a different workspace' };
                }

                // Validate parent is a workstream (has children)
                const { database } = await import('../database/PGLiteDatabaseWorker');
                const { rows } = await database.query<{ count: number }>(
                    'SELECT COUNT(*) as count FROM ai_sessions WHERE parent_session_id = $1',
                    [newParentId]
                );
                const childCount = parseInt(String(rows[0]?.count || '0'));

                // Parent must already have children to be a valid drop target
                // (or be explicitly marked as a workstream root in metadata)
                const parentMetadata = parent.metadata || {};
                const isWorkstreamRoot = (parentMetadata as any).isWorkstreamRoot === true;

                if (childCount === 0 && !isWorkstreamRoot) {
                    return { success: false, error: 'Parent session must be a workstream (have children)' };
                }
            }

            // Update parent_session_id
            await AISessionsRepository.updateMetadata(sessionId, { parentSessionId: newParentId });

            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to set session parent:', error);
            return { success: false, error: String(error) };
        }
    });

    // Search sessions for workspace (full content search)
    safeHandle('sessions:search', async (event, workspacePath: string, query: string, options?: { includeArchived?: boolean }) => {
        try {
            const entries = await AISessionsRepository.search(workspacePath, query, options);
            const sessions = [];

            for (const entry of entries) {
                const session = await AISessionsRepository.get(entry.id);
                if (session) {
                    sessions.push({
                        id: session.id,
                        createdAt: session.createdAt,
                        updatedAt: session.updatedAt,
                        name: session.title,
                        title: session.title,
                        provider: session.provider,
                        model: session.model,
                        sessionType: session.sessionType || 'chat',
                        messageCount: entry.messageCount || 0,
                        isArchived: entry.isArchived || false,
                        worktreeId: session.worktreeId,  // Include worktreeId from session data
                        metadata: session.metadata || {}
                    });
                }
            }

            return { success: true, sessions };
        } catch (error) {
            console.error('[SessionHandlers] Failed to search sessions:', error);
            return { success: false, error: String(error), sessions: [] };
        }
    });

    // Delete session
    safeHandle('sessions:delete', async (event, sessionId: string) => {
        try {
            await AISessionsRepository.delete(sessionId);
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to delete session:', error);
            return { success: false, error: String(error) };
        }
    });

    // Update session pinned status
    safeHandle('sessions:update-pinned', async (_event, sessionId: string, isPinned: boolean) => {
        try {
            await AISessionsRepository.updateMetadata(sessionId, { isPinned } as any);
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to update session pinned status:', error);
            return { success: false, error: String(error) };
        }
    });

    // Migrate unassigned sessions to a workspace
    safeHandle('sessions:migrate-unassigned', async (event, workspacePath: string) => {
        try {
            const { migrateUnassignedSessions, countUnassignedSessions } = await import('../services/migrateUnassignedSessions');
            const { getDatabase } = await import('../services/PGLiteSessionStore');
            const db = getDatabase();

            if (!db) {
                return { success: false, error: 'Database not initialized' };
            }

            const countBefore = await countUnassignedSessions(db);
            const result = await migrateUnassignedSessions(db, workspacePath);

            console.log(`[SessionHandlers] Migrated ${result.migrated} sessions to workspace: ${workspacePath}`);

            return {
                success: true,
                migrated: result.migrated,
                countBefore
            };
        } catch (error) {
            console.error('[SessionHandlers] Failed to migrate sessions:', error);
            return { success: false, error: String(error) };
        }
    });

    // Mark session as read (update read state)
    safeHandle('sessions:mark-read', async (event, sessionId: string, lastMessageTimestamp: number | null) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');
            // Store timestamp using to_timestamp() to avoid timezone issues
            if (lastMessageTimestamp) {
                await database.query(
                    `UPDATE ai_sessions
                     SET last_read_timestamp = to_timestamp($1 / 1000.0), last_read_message_id = NULL
                     WHERE id = $2`,
                    [lastMessageTimestamp, sessionId]
                );
            } else {
                await database.query(
                    `UPDATE ai_sessions
                     SET last_read_timestamp = NULL, last_read_message_id = NULL
                     WHERE id = $1`,
                    [sessionId]
                );
            }
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Error marking session as read:', error);
            return { success: false, error: String(error) };
        }
    });

    // Get active session - not implemented, returns null
    safeHandle('session:get-active', async (event, filePath: string) => {
        // This API doesn't exist in current SessionManager
        // Would need to track active sessions per file separately
        return null;
    });

    // Set active session - not implemented, no-op
    safeHandle('session:set-active', async (event, filePath: string, sessionId: string, type: string) => {
        // This API doesn't exist in current SessionManager
        // Would need to track active sessions per file separately
    });

    // Check conflicts - not implemented, returns no conflicts
    safeHandle('session:check-conflicts', async (event, session: any, currentMarkdownHash: string) => {
        // Conflict checking isn't implemented in current system
        return { hasConflicts: false };
    });

    // Resolve conflict - not implemented, no-op
    safeHandle('session:resolve-conflict', async (event, session: any, resolution: string, newBaseHash?: string) => {
        // Conflict resolution isn't implemented in current system
    });

    // Create checkpoint - not implemented, no-op
    safeHandle('session:create-checkpoint', async (event, sessionId: string, state: string) => {
        // Checkpoints aren't implemented in current system
    });

    // Get sessions by file path
    safeHandle('sessions:get-by-file', async (event, workspaceId: string, filePath: string) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            // Query session_files table to get session IDs that have interacted with this file
            const fileLinksResult = await database.query(
                `SELECT DISTINCT session_id FROM session_files
                 WHERE workspace_id = $1 AND file_path = $2`,
                [workspaceId, filePath]
            );

            if (!fileLinksResult.rows || fileLinksResult.rows.length === 0) {
                return [];
            }

            const sessionIds = fileLinksResult.rows.map((row: any) => row.session_id);

            // Get list entries with messageCount
            const listEntries = await AISessionsRepository.list(workspaceId);
            const entriesMap = new Map(listEntries.map(entry => [entry.id, entry]));

            // Load full session data for each session ID
            const sessions = await Promise.all(
                sessionIds.map(async (sessionId: string) => {
                    try {
                        const session = await AISessionsRepository.get(sessionId);
                        const entry = entriesMap.get(sessionId);

                        return session ? {
                            id: session.id,
                            title: session.title || 'Untitled Session',
                            provider: session.provider,
                            model: session.model,
                            createdAt: session.createdAt,
                            updatedAt: session.updatedAt,
                            messageCount: entry?.messageCount || 0
                        } : null;
                    } catch (err) {
                        console.error(`[SessionHandlers] Failed to load session ${sessionId}:`, err);
                        return null;
                    }
                })
            );

            // Filter out nulls and sort by most recent first
            return sessions
                .filter(s => s !== null)
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        } catch (error) {
            console.error('[SessionHandlers] Error getting sessions by file:', error);
            return [];
        }
    });

    // Test-only: Query database directly (for e2e tests and debugging)
    // This handler is safe to leave registered as it's read-only
    safeHandle('test:query-db', async (event, sql: string, params?: any[]) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');
            const result = await database.query(sql, params);
            return result;
        } catch (error) {
            console.error('[SessionHandlers] Test query error:', error);
            return { error: String(error) };
        }
    });

    // Get FTS index status - check if index exists and get message count
    safeHandle('sessions:get-fts-index-status', async (event, workspaceId: string) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            // Check if index exists
            const indexResult = await database.query(`
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_ai_agent_messages_content_fts'
            `);
            const indexExists = indexResult.rows.length > 0;

            // Get message count for this workspace
            const countResult = await database.query<{ count: string }>(`
                SELECT COUNT(*) as count
                FROM ai_agent_messages m
                JOIN ai_sessions s ON m.session_id = s.id
                WHERE s.workspace_id = $1
            `, [workspaceId]);
            const messageCount = parseInt(countResult.rows[0]?.count || '0');

            return { indexExists, messageCount };
        } catch (error) {
            console.error('[SessionHandlers] Error getting FTS index status:', error);
            return { indexExists: false, messageCount: 0, error: String(error) };
        }
    });

    // Build FTS index on demand (for large databases where we skipped at startup)
    safeHandle('sessions:build-fts-index', async (event) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            const startTime = Date.now();
            console.log('[SessionHandlers] Starting FTS index build...');

            // Build partial index excluding large messages (>500KB) to avoid tsvector 1MB limit
            // Use 10 minute timeout since index building can take a long time for large databases
            await database.exec(`
                CREATE INDEX IF NOT EXISTS idx_ai_agent_messages_content_fts
                ON ai_agent_messages USING GIN(to_tsvector('english', content))
                WHERE LENGTH(content) < 500000
            `, 10 * 60 * 1000);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[SessionHandlers] FTS index built successfully in ${elapsed}s`);
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Error building FTS index:', error);
            return { success: false, error: String(error) };
        }
    });

    // List recent user prompts for prompt history quick-open
    safeHandle('messages:list-user-prompts', async (event, workspacePath: string, limit: number = 2000) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            const { rows } = await database.query<{
                id: string;
                session_id: string;
                content: string;
                created_at: Date;
                session_title: string;
                provider: string;
                parent_session_id: string | null;
            }>(
                `SELECT
                    m.id,
                    m.session_id,
                    m.content,
                    m.created_at,
                    s.title as session_title,
                    s.provider,
                    s.parent_session_id
                 FROM ai_agent_messages m
                 JOIN ai_sessions s ON m.session_id = s.id
                 WHERE m.direction = 'input'
                   AND s.workspace_id = $1
                 ORDER BY m.created_at DESC
                 LIMIT $2`,
                [workspacePath, limit]
            );

            const prompts = rows.map(row => ({
                id: row.id,
                sessionId: row.session_id,
                content: row.content,
                createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
                sessionTitle: row.session_title || 'Untitled Session',
                provider: row.provider,
                parentSessionId: row.parent_session_id,
            }));

            return { success: true, prompts };
        } catch (error) {
            console.error('[SessionHandlers] Failed to list user prompts:', error);
            return { success: false, error: String(error), prompts: [] };
        }
    });
}

export { sessionManager };

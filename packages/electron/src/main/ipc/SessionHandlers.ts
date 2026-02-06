import { SessionManager, ProviderFactory } from '@nimbalyst/runtime/ai/server';
import { AISessionsRepository } from '@nimbalyst/runtime';
import { ModelIdentifier, type AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import type { UpdateSessionMetadataPayload } from '@nimbalyst/runtime/ai/adapters/sessionStore';
import path from "path";
import { existsSync } from "fs";
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import type { SessionCreateResult } from '../../shared/ipc/types';

// Initialize session manager
const sessionManager = new SessionManager();

// Track if handlers are registered to prevent double registration
let handlersRegistered = false;

// ============================================================
// Git Status Cache
// Caches uncommitted file sets to avoid repeated git status calls
// when multiple components request session lists simultaneously.
// ============================================================
interface GitStatusCache {
    uncommittedFiles: Set<string>;
    timestamp: number;
}

const gitStatusCache = new Map<string, GitStatusCache>();
const GIT_STATUS_CACHE_TTL_MS = 5000; // 5 second cache

// ============================================================
// Session Files Cache
// Caches the session_files query result to avoid slow DB queries
// when multiple components request session lists simultaneously.
// ============================================================
interface SessionFilesCache {
    /** Map of file_path -> session_id (most recent editor of each file) */
    fileToSession: Map<string, string>;
    timestamp: number;
}

const sessionFilesCache = new Map<string, SessionFilesCache>();
const SESSION_FILES_CACHE_TTL_MS = 5000; // 5 second cache

/**
 * Get session files mapping with caching.
 * Returns a map of file_path -> session_id for the most recent session that edited each file.
 * Avoids running expensive DISTINCT ON query multiple times in rapid succession.
 */
async function getCachedSessionFiles(workspacePath: string): Promise<Map<string, string>> {
    const cached = sessionFilesCache.get(workspacePath);
    if (cached && Date.now() - cached.timestamp < SESSION_FILES_CACHE_TTL_MS) {
        return cached.fileToSession;
    }

    const { database } = await import('../database/PGLiteDatabaseWorker');

    // Get the MOST RECENT session that edited each file
    const { rows: sessionFiles } = await database.query<{ session_id: string; file_path: string }>(
        `SELECT DISTINCT ON (file_path) session_id, file_path
         FROM session_files
         WHERE workspace_id = $1 AND link_type = 'edited'
         ORDER BY file_path, timestamp DESC`,
        [workspacePath]
    );

    const fileToSession = new Map<string, string>();
    sessionFiles.forEach(row => {
        fileToSession.set(row.file_path, row.session_id);
    });

    sessionFilesCache.set(workspacePath, {
        fileToSession,
        timestamp: Date.now()
    });

    return fileToSession;
}

/**
 * Invalidate session files cache for a workspace.
 * Call this when files are edited to ensure fresh data on next query.
 */
export function invalidateSessionFilesCache(workspacePath: string): void {
    sessionFilesCache.delete(workspacePath);
}

/**
 * Get uncommitted files with caching.
 * Avoids spawning git status multiple times in rapid succession.
 */
async function getCachedUncommittedFiles(workspacePath: string): Promise<Set<string>> {
    // Non-git workspaces have no uncommitted files
    if (!existsSync(path.join(workspacePath, '.git'))) {
        return new Set();
    }

    const cached = gitStatusCache.get(workspacePath);
    if (cached && Date.now() - cached.timestamp < GIT_STATUS_CACHE_TTL_MS) {
        return cached.uncommittedFiles;
    }

    const simpleGit = (await import('simple-git')).default;
    const git = simpleGit(workspacePath);
    const status = await git.status();

    const uncommittedFiles = new Set([
        ...status.modified,
        ...status.created,
        ...status.not_added,
        ...status.deleted,
        ...status.renamed.map(r => r.to),
        ...status.staged
    ]);

    gitStatusCache.set(workspacePath, {
        uncommittedFiles,
        timestamp: Date.now()
    });

    return uncommittedFiles;
}

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
    safeHandle('sessions:create', async (event, payload: { session: any; workspaceId: string }): Promise<SessionCreateResult> => {
        try {
            const { session, workspaceId } = payload;

            // Extract and sync provider from model ID if model follows "provider:model" format
            let provider = session.provider as AIProviderType;
            let model = session.model;

            if (model) {
                const modelId = ModelIdentifier.tryParse(model);
                if (modelId) {
                    provider = modelId.provider;
                }
            } else {
                // No model provided - get default for the provider using ModelIdentifier
                model = ModelIdentifier.getDefaultModelId(provider);
                console.log(`[SessionHandlers] No model provided, using default: ${model}`);
            }

            const createPayload = {
                id: session.id,
                provider,
                model,
                title: session.title || 'Untitled',
                workspaceId: workspaceId,
                providerConfig: session.providerConfig,
                providerSessionId: session.providerSessionId,
                worktreeId: session.worktreeId || null
            };
            // console.log('[SessionHandlers] Creating session with payload:', JSON.stringify(createPayload));

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
    safeHandle('sessions:update-metadata', async (event, sessionId: string, updates: UpdateSessionMetadataPayload) => {
        try {
            // When model is updated, extract and sync the provider from the model ID
            // Model IDs follow the format "provider:model-name" (e.g., "claude-code:opus", "openai:gpt-4o")
            let providerType: AIProviderType | undefined;
            if (updates.model) {
                const modelId = ModelIdentifier.tryParse(updates.model);
                if (modelId) {
                    updates.provider = modelId.provider;
                    providerType = modelId.provider;
                }

                // Invalidate the cached provider so it gets re-created with the new model
                // on the next message. This ensures model changes take effect immediately.
                if (providerType) {
                    console.log(`[SessionHandlers] Model changed to ${updates.model}, invalidating provider for session ${sessionId}`);
                    ProviderFactory.destroyProvider(sessionId, providerType);
                } else {
                    // If we couldn't parse the provider, destroy all providers for this session
                    console.log(`[SessionHandlers] Model changed to ${updates.model}, invalidating all providers for session ${sessionId}`);
                    ProviderFactory.destroyProvider(sessionId);
                }
            }
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
            // Uses cached git status and session files to avoid redundant queries
            const uncommittedMap = new Map<string, number>();
            try {
                const uncommittedFiles = await getCachedUncommittedFiles(workspacePath);

                if (uncommittedFiles.size > 0) {
                    // Use cached session files query
                    const fileToSession = await getCachedSessionFiles(workspacePath);

                    // Count uncommitted files per session (only for the session that last edited each file)
                    fileToSession.forEach((sessionId, filePath) => {
                        const relativePath = filePath.replace(workspacePath + '/', '');
                        if (uncommittedFiles.has(relativePath)) {
                            uncommittedMap.set(sessionId, (uncommittedMap.get(sessionId) || 0) + 1);
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
                    hasUnread: (entry as any).hasUnread || false,  // Unread state from metadata
                    hasPendingQuestion: (entry as any).hasPendingQuestion || false,  // Pending AskUserQuestion state from metadata
                    // Branch tracking - SEPARATE from hierarchical parentSessionId
                    branchedFromSessionId: (entry as any).branchedFromSessionId,
                    branchPointMessageId: entry.branchPointMessageId,
                    branchedAt: entry.branchedAt,
                    metadata: {}
                };
            });

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

            // Calculate uncommitted file counts per session
            // Uses cached git status and session files to avoid redundant queries
            const uncommittedMap = new Map<string, number>();
            try {
                const uncommittedFiles = await getCachedUncommittedFiles(workspacePath);

                if (uncommittedFiles.size > 0) {
                    // Get the session IDs we care about (children of this parent)
                    const childSessionIds = new Set(rows.map((r: any) => r.id));

                    // Use cached session files query
                    const fileToSession = await getCachedSessionFiles(workspacePath);

                    // Count uncommitted files per session (only for child sessions)
                    fileToSession.forEach((sessionId, filePath) => {
                        if (childSessionIds.has(sessionId)) {
                            const relativePath = filePath.replace(workspacePath + '/', '');
                            if (uncommittedFiles.has(relativePath)) {
                                uncommittedMap.set(sessionId, (uncommittedMap.get(sessionId) || 0) + 1);
                            }
                        }
                    });
                }
            } catch (error) {
                console.error('[SessionHandlers] Failed to get uncommitted counts for children:', error);
            }

            const children = rows.map((row: any) => ({
                id: row.id,
                title: row.title || 'Untitled Session',
                provider: row.provider,
                model: row.model,
                createdAt: row.created_at instanceof Date ? row.created_at.getTime() : new Date(row.created_at).getTime(),
                updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : new Date(row.updated_at).getTime(),
                messageCount: parseInt(row.message_count) || 0,
                parentSessionId: row.parent_session_id,
                isArchived: row.is_archived || false,
                isPinned: row.is_pinned || false,
                uncommittedCount: uncommittedMap.get(row.id) || 0,
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
        model?: string;
    }) => {
        console.log('[SessionHandlers] sessions:create-child called with:', JSON.stringify(payload));
        try {
            const { parentSessionId, workspacePath, worktreeId, provider = 'claude-code', model: providedModel } = payload;
            // Use crypto.randomUUID() instead of dynamic import to avoid bundling issues
            const sessionId = crypto.randomUUID();
            console.log(`[SessionHandlers] Creating child session ${sessionId} for parent ${parentSessionId}`);

            // Use provided model, or fall back to hardcoded default
            const model = providedModel || ModelIdentifier.getDefaultModelId(provider as AIProviderType);

            const createPayload = {
                id: sessionId,
                provider,
                model,  // Include proper model ID
                title: 'New Session',
                workspaceId: workspacePath,
                parentSessionId,  // Link to parent
                worktreeId: worktreeId || null,  // Inherit from parent if provided
            };

            await AISessionsRepository.create(createPayload as any);
            console.log(`[SessionHandlers] Child session ${sessionId} created successfully with model: ${model}`);

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
    safeHandle('sessions:search', async (event, workspacePath: string, query: string, options?: {
        includeArchived?: boolean;
        timeRange?: '7d' | '30d' | '90d' | 'all';
        direction?: 'all' | 'input' | 'output';
    }) => {
        try {
            const entries = await AISessionsRepository.search(workspacePath, query, options);

            // Use batch query instead of N individual get() calls
            const sessionIds = entries.map(e => e.id);
            const sessionsData = await AISessionsRepository.getMany(sessionIds);

            // Create a map for O(1) lookups to merge with entry data
            const sessionMap = new Map(sessionsData.map(s => [s.id, s]));

            const sessions = entries
                .map(entry => {
                    const session = sessionMap.get(entry.id);
                    if (!session) return null;
                    return {
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
                        worktreeId: session.worktreeId,
                        metadata: session.metadata || {}
                    };
                })
                .filter((s): s is NonNullable<typeof s> => s !== null);

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

            // Use batch query instead of N individual get() calls
            const sessionsData = await AISessionsRepository.getMany(sessionIds);

            // Map and enrich with entry data
            const sessions = sessionsData
                .map(session => {
                    const entry = entriesMap.get(session.id);
                    return {
                        id: session.id,
                        title: session.title || 'Untitled Session',
                        provider: session.provider,
                        model: session.model,
                        createdAt: session.createdAt,
                        updatedAt: session.updatedAt,
                        messageCount: entry?.messageCount || 0
                    };
                })
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            return sessions;
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

    // ============================================================
    // Test-only handlers for E2E testing without AI agent
    // These allow inserting mock sessions and messages for testing
    // interactive prompt widgets in isolation.
    // SECURITY: Only registered in development/test environments.
    // ============================================================

    const isTestEnv = process.env.NODE_ENV === 'development' ||
                      process.env.NODE_ENV === 'test' ||
                      process.env.PLAYWRIGHT_TEST === 'true';

    if (!isTestEnv) {
        console.log('[SessionHandlers] Skipping test handlers in production');
    }

    /**
     * Test-only: Create a test session directly in the database.
     * Used for E2E testing interactive prompts without invoking the AI agent.
     */
    if (isTestEnv) safeHandle('test:insert-session', async (event, payload: {
        id: string;
        workspaceId: string;
        provider?: string;
        model?: string;
        title?: string;
    }) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');
            const { id, workspaceId, provider = 'claude-code', model = 'opus', title = 'Test Session' } = payload;

            await database.query(
                `INSERT INTO ai_sessions (id, workspace_id, provider, model, title, session_type, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, 'chat', NOW(), NOW())`,
                [id, workspaceId, provider, model, title]
            );

            // Notify renderer to refresh session list
            event.sender.send('sessions:refresh-list', {
                workspacePath: workspaceId,
                sessionId: id
            });

            return { success: true, id };
        } catch (error) {
            console.error('[SessionHandlers] test:insert-session error:', error);
            return { success: false, error: String(error) };
        }
    });

    /**
     * Test-only: Insert a message directly into ai_agent_messages.
     * Used for E2E testing interactive prompts without invoking the AI agent.
     */
    if (isTestEnv) safeHandle('test:insert-message', async (event, payload: {
        sessionId: string;
        direction: 'input' | 'output';
        content: string;
        source?: string;
        metadata?: any;
    }) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');
            const { sessionId, direction, content, source = 'nimbalyst', metadata } = payload;

            const { rows } = await database.query<{ id: string }>(
                `INSERT INTO ai_agent_messages (session_id, source, direction, content, metadata, created_at, hidden)
                 VALUES ($1, $2, $3, $4, $5, NOW(), false)
                 RETURNING id`,
                [sessionId, source, direction, content, metadata ? JSON.stringify(metadata) : null]
            );
            return { success: true, id: rows[0].id };
        } catch (error) {
            console.error('[SessionHandlers] test:insert-message error:', error);
            return { success: false, error: String(error) };
        }
    });

    /**
     * Test-only: Clean up test sessions for a workspace.
     * Removes sessions with titles starting with 'Test Session'.
     */
    if (isTestEnv) safeHandle('test:clear-test-sessions', async (event, workspaceId: string) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            // Delete messages first (foreign key constraint)
            await database.query(
                `DELETE FROM ai_agent_messages WHERE session_id IN (
                   SELECT id FROM ai_sessions WHERE workspace_id = $1 AND title LIKE 'Test Session%'
                 )`,
                [workspaceId]
            );

            // Then delete sessions
            await database.query(
                `DELETE FROM ai_sessions WHERE workspace_id = $1 AND title LIKE 'Test Session%'`,
                [workspaceId]
            );

            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] test:clear-test-sessions error:', error);
            return { success: false, error: String(error) };
        }
    });

    // Get FTS index status - check if index exists AND if backfill has been done
    safeHandle('sessions:get-fts-index-status', async (event, workspaceId: string) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            // Check if FTS index exists by querying pg_indexes
            const indexResult = await database.query(`
                SELECT 1 FROM pg_indexes
                WHERE indexname = 'idx_ai_agent_messages_content_fts'
            `);
            const indexExistsInDb = indexResult.rows.length > 0;

            // Get total message count for this workspace
            const countResult = await database.query<{ count: string }>(`
                SELECT COUNT(*) as count
                FROM ai_agent_messages m
                JOIN ai_sessions s ON m.session_id = s.id
                WHERE s.workspace_id = $1
            `, [workspaceId]);
            const messageCount = parseInt(countResult.rows[0]?.count || '0');

            // Quick heuristic: check ratio of searchable to total messages
            // This is fast because it just counts, no pattern matching
            const ratioResult = await database.query<{ searchable: string; total: string }>(`
                SELECT
                  COUNT(*) FILTER (WHERE searchable = true) as searchable,
                  COUNT(*) as total
                FROM ai_agent_messages
            `);
            const searchableCount = parseInt(ratioResult.rows[0]?.searchable || '0');
            const totalMessages = parseInt(ratioResult.rows[0]?.total || '0');

            // Backfill is needed if we have lots of messages but very few are searchable
            // Expected ratio after backfill is ~15-20% (user prompts + assistant text responses)
            const searchableRatio = totalMessages > 0 ? searchableCount / totalMessages : 1;
            const needsBackfill = totalMessages > 5000 && searchableRatio < 0.01;

            // Index is only "ready" if it exists AND backfill has been done
            const indexExists = indexExistsInDb && !needsBackfill;

            return { indexExists, messageCount };
        } catch (error) {
            console.error('[SessionHandlers] Error getting FTS index status:', error);
            return { indexExists: false, messageCount: 0, error: String(error) };
        }
    });

    // Build FTS index on demand (for large databases where we skipped at startup)
    // This first backfills the searchable column, then builds a partial index on searchable messages only
    safeHandle('sessions:build-fts-index', async (event) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            const startTime = Date.now();
            console.log('[SessionHandlers] Starting FTS index build...');

            // Step 1: Backfill searchable column for existing messages
            // Only mark user prompts and assistant text (no tool content) as searchable
            // Also exclude messages over 500KB to avoid tsvector 1MB limit
            console.log('[SessionHandlers] Backfilling searchable column...');
            const backfillStart = Date.now();
            await database.exec(`
                UPDATE ai_agent_messages SET searchable = true
                WHERE LENGTH(content) < 500000
                  AND source = 'claude-code'
                  AND (
                    -- User prompts
                    (direction = 'input' AND content LIKE '{"prompt":%')
                    -- Assistant text responses (no tool content)
                    OR (content LIKE '%"type":"assistant"%'
                        AND content LIKE '%"type":"text"%'
                        AND content NOT LIKE '%"type":"tool_use"%'
                        AND content NOT LIKE '%"type":"tool_result"%')
                  )
            `, 10 * 60 * 1000);
            const backfillElapsed = ((Date.now() - backfillStart) / 1000).toFixed(1);
            console.log(`[SessionHandlers] Backfill completed in ${backfillElapsed}s`);

            // Step 2: Drop existing index (if any) and rebuild with backfilled data
            console.log('[SessionHandlers] Building FTS index on searchable messages...');
            const indexStart = Date.now();
            await database.exec(`DROP INDEX IF EXISTS idx_ai_agent_messages_content_fts`, 60 * 1000);
            await database.exec(`
                CREATE INDEX idx_ai_agent_messages_content_fts
                ON ai_agent_messages USING GIN(to_tsvector('english', content))
                WHERE searchable = true
            `, 10 * 60 * 1000);
            const indexElapsed = ((Date.now() - indexStart) / 1000).toFixed(1);
            console.log(`[SessionHandlers] Index build completed in ${indexElapsed}s`);

            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[SessionHandlers] FTS index built successfully in ${totalElapsed}s total`);
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
                   AND (m.hidden = FALSE OR m.hidden IS NULL)
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

    // Get uncommitted file counts per session (lightweight, for updating after git commits)
    // Returns counts for ALL sessions that have edited files, including 0 for fully committed sessions
    // Uses cached git status and session files when called in rapid succession
    safeHandle('sessions:get-uncommitted-counts', async (event, workspacePath: string) => {
        try {
            const uncommittedFiles = await getCachedUncommittedFiles(workspacePath);

            // Use cached session files query
            const fileToSession = await getCachedSessionFiles(workspacePath);

            // Initialize counts for all sessions that have edited files (start at 0)
            const counts: Record<string, number> = {};
            fileToSession.forEach((sessionId) => {
                if (!counts[sessionId]) {
                    counts[sessionId] = 0;
                }
            });

            // Count uncommitted files per session
            fileToSession.forEach((sessionId, filePath) => {
                const relativePath = filePath.replace(workspacePath + '/', '');
                if (uncommittedFiles.has(relativePath)) {
                    counts[sessionId] = (counts[sessionId] || 0) + 1;
                }
            });

            return { success: true, counts };
        } catch (error) {
            console.error('[SessionHandlers] Failed to get uncommitted counts:', error);
            return { success: false, error: String(error), counts: {} };
        }
    });

    // ============================================================
    // Interactive Prompts - Durable AI-to-User Interactions
    // These handlers support the durable interactive prompts architecture
    // where the database is the source of truth for pending prompts.
    // ============================================================

    /**
     * Get all pending interactive prompts for a session.
     * Returns prompts where status is 'pending' and no response message exists.
     */
    safeHandle('messages:get-pending-prompts', async (event, sessionId: string) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');

            // Query for pending prompt messages
            // We check for messages with type containing 'request' and status 'pending'
            const { rows } = await database.query<{
                id: string;
                session_id: string;
                content: string;
                created_at: Date;
                metadata: any;
            }>(
                `SELECT id, session_id, content, created_at, metadata
                 FROM ai_agent_messages
                 WHERE session_id = $1
                   AND (hidden = FALSE OR hidden IS NULL)
                   AND content LIKE '%"status":"pending"%'
                   AND (content LIKE '%"type":"permission_request"%'
                        OR content LIKE '%"type":"ask_user_question_request"%'
                        OR content LIKE '%"type":"exit_plan_mode_request"%'
                        OR content LIKE '%"type":"git_commit_proposal"%')
                 ORDER BY created_at ASC`,
                [sessionId]
            );

            // Parse and validate the prompts
            const pendingPrompts = [];
            for (const row of rows) {
                try {
                    const content = JSON.parse(row.content);
                    if (content.status === 'pending') {
                        // Check if there's already a response for this prompt
                        const promptId = content.requestId || content.questionId || content.proposalId;
                        const responseType = content.type === 'permission_request'
                            ? 'permission_response'
                            : content.type === 'ask_user_question_request'
                            ? 'ask_user_question_response'
                            : content.type === 'exit_plan_mode_request'
                            ? 'exit_plan_mode_response'
                            : content.type === 'git_commit_proposal'
                            ? 'git_commit_proposal_response'
                            : null;

                        if (!responseType) {
                            continue; // Unknown type, skip
                        }

                        const { rows: responseRows } = await database.query(
                            `SELECT id FROM ai_agent_messages
                             WHERE session_id = $1
                               AND content LIKE $2
                             LIMIT 1`,
                            [sessionId, `%"${responseType}"%"${promptId}"%`]
                        );

                        // Only include if no response exists
                        if (responseRows.length === 0) {
                            pendingPrompts.push({
                                id: row.id,
                                sessionId: row.session_id,
                                content,
                                createdAt: row.created_at instanceof Date ? row.created_at.getTime() : row.created_at,
                            });
                        }
                    }
                } catch {
                    // Skip invalid JSON
                }
            }

            return { success: true, prompts: pendingPrompts };
        } catch (error) {
            console.error('[SessionHandlers] Failed to get pending prompts:', error);
            return { success: false, error: String(error), prompts: [] };
        }
    });

    /**
     * Respond to an interactive prompt.
     * Creates a response message and optionally updates the request status.
     */
    safeHandle('messages:respond-to-prompt', async (event, params: {
        sessionId: string;
        promptId: string;
        promptType: 'permission_request' | 'ask_user_question_request' | 'exit_plan_mode_request' | 'git_commit_proposal_request';
        response: any;
        respondedBy: 'desktop' | 'mobile';
    }) => {
        try {
            const { sessionId, promptId, promptType, response, respondedBy } = params;
            const { database } = await import('../database/PGLiteDatabaseWorker');
            const timestamp = Date.now();

            // Determine response type and content
            let responseContent: any;
            if (promptType === 'permission_request') {
                responseContent = {
                    type: 'permission_response',
                    requestId: promptId,
                    decision: response.decision,
                    scope: response.scope,
                    respondedAt: timestamp,
                    respondedBy,
                };
            } else if (promptType === 'ask_user_question_request') {
                responseContent = {
                    type: 'ask_user_question_response',
                    questionId: promptId,
                    answers: response.answers || response,
                    cancelled: response.cancelled || false,
                    respondedAt: timestamp,
                    respondedBy,
                };
            } else if (promptType === 'exit_plan_mode_request') {
                responseContent = {
                    type: 'exit_plan_mode_response',
                    requestId: promptId,
                    approved: response.approved,
                    clearContext: response.clearContext,
                    feedback: response.feedback,
                    respondedAt: timestamp,
                    respondedBy,
                };
            } else if (promptType === 'git_commit_proposal_request') {
                responseContent = {
                    type: 'git_commit_proposal_response',
                    proposalId: promptId,
                    action: response.action,
                    commitHash: response.commitHash,
                    error: response.error,
                    filesCommitted: response.filesCommitted,
                    commitMessage: response.commitMessage,
                    respondedAt: timestamp,
                    respondedBy,
                };
            }

            // Insert response message
            await database.query(
                `INSERT INTO ai_agent_messages (session_id, source, direction, content, created_at, hidden)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    sessionId,
                    'nimbalyst',
                    'output',
                    JSON.stringify(responseContent),
                    new Date(timestamp),
                    false,
                ]
            );

            // For git_commit_proposal, also emit to httpServer's legacy listener
            if (promptType === 'git_commit_proposal_request') {
                const { ipcMain } = await import('electron');
                ipcMain.emit(promptId, null, response);
            }

            return { success: true, responseContent };
        } catch (error) {
            console.error('[SessionHandlers] Failed to respond to prompt:', error);
            return { success: false, error: String(error) };
        }
    });
}

export { sessionManager };

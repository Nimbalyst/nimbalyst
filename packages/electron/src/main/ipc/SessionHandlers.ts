import { ipcMain } from 'electron';
import { SessionManager } from '@nimbalyst/runtime/ai/server';
import { AISessionsRepository } from '@nimbalyst/runtime';
import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';
import path from "path";

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
    ipcMain.handle('session:create', async (event, filePath: string, type: string, source?: any) => {
        const documentContext = filePath ? { content: '', filePath } : undefined;
        return await sessionManager.createSession(type as any, documentContext, source);
    });

    // Create session (new format for agentic coding)
    ipcMain.handle('sessions:create', async (event, payload: { session: any; workspaceId: string }) => {
        try {
            const { session, workspaceId } = payload;

            await AISessionsRepository.create({
                id: session.id,
                provider: session.provider,
                model: session.model,
                title: session.metadata?.planDocumentPath ? `Plan: ${path.basename(session.metadata.planDocumentPath)}` : 'Agentic Coding',
                workspaceId: workspaceId,
                providerConfig: session.providerConfig,
                providerSessionId: session.providerSessionId
            });

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
    ipcMain.handle('session:load', async (event, sessionId: string) => {
        return await sessionManager.loadSession(sessionId);
    });

    // Save session - maps to updateSessionMessages
    ipcMain.handle('session:save', async (event, session: any) => {
        if (session?.id && session?.messages) {
            await sessionManager.updateSessionMessages(session.id, session.messages);
        }
    });

    // Delete session
    ipcMain.handle('session:delete', async (event, sessionId: string) => {
        await sessionManager.deleteSession(sessionId);
    });

    // Update session title
    ipcMain.handle('sessions:update-title', async (event, sessionId: string, title: string) => {
        await sessionManager.updateSessionTitle(sessionId, title, {
            force: true,
            markAsNamed: true,
        });
    });

    // Update session model
    ipcMain.handle('sessions:update-model', async (event, sessionId: string, model: string) => {
        await sessionManager.updateSessionModel(sessionId, model);
    });

    // Update session provider and model (when switching between providers)
    ipcMain.handle('sessions:update-provider-and-model', async (event, sessionId: string, provider: string, model: string) => {
        await sessionManager.updateSessionProviderAndModel(sessionId, provider, model);
    });

    // Update session draft input
    ipcMain.handle('sessions:update-draft-input', async (event, sessionId: string, draftInput: string) => {
        await sessionManager.updateSessionDraftInput(sessionId, draftInput);
    });

    // Update session metadata (including mode)
    ipcMain.handle('ai-sessions:update-metadata', async (event, sessionId: string, updates: any) => {
        try {
            await AISessionsRepository.updateMetadata(sessionId, updates);
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to update session metadata:', error);
            return { success: false, error: String(error) };
        }
    });

    // Update session metadata with extended fields
    ipcMain.handle('sessions:update-session-metadata', async (event, sessionId: string, updates: any) => {
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

    // List sessions for workspace
    ipcMain.handle('sessions:list', async (event, workspacePath: string) => {
        try {
            const entries = await AISessionsRepository.list(workspacePath);
            // Use entry data directly - it already has all the info we need including updatedAt
            const sessions = entries.map(entry => ({
                id: entry.id,
                createdAt: entry.createdAt,
                updatedAt: entry.updatedAt,
                name: entry.title,
                title: entry.title,
                provider: entry.provider,
                model: entry.model,
                sessionType: entry.sessionType || 'chat',
                messageCount: entry.messageCount || 0,
                metadata: {}
            }));

            return { success: true, sessions };
        } catch (error) {
            console.error('[SessionHandlers] Failed to list sessions:', error);
            return { success: false, error: String(error), sessions: [] };
        }
    });

    // Search sessions for workspace (full content search)
    ipcMain.handle('sessions:search', async (event, workspacePath: string, query: string) => {
        try {
            const entries = await AISessionsRepository.search(workspacePath, query);
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
    ipcMain.handle('sessions:delete', async (event, sessionId: string) => {
        try {
            await AISessionsRepository.delete(sessionId);
            return { success: true };
        } catch (error) {
            console.error('[SessionHandlers] Failed to delete session:', error);
            return { success: false, error: String(error) };
        }
    });

    // Mark session as read (update read state)
    ipcMain.handle('sessions:mark-read', async (event, sessionId: string, lastMessageTimestamp: number | null) => {
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
    ipcMain.handle('session:get-active', async (event, filePath: string) => {
        // This API doesn't exist in current SessionManager
        // Would need to track active sessions per file separately
        return null;
    });

    // Set active session - not implemented, no-op
    ipcMain.handle('session:set-active', async (event, filePath: string, sessionId: string, type: string) => {
        // This API doesn't exist in current SessionManager
        // Would need to track active sessions per file separately
    });

    // Check conflicts - not implemented, returns no conflicts
    ipcMain.handle('session:check-conflicts', async (event, session: any, currentMarkdownHash: string) => {
        // Conflict checking isn't implemented in current system
        return { hasConflicts: false };
    });

    // Resolve conflict - not implemented, no-op
    ipcMain.handle('session:resolve-conflict', async (event, session: any, resolution: string, newBaseHash?: string) => {
        // Conflict resolution isn't implemented in current system
    });

    // Create checkpoint - not implemented, no-op
    ipcMain.handle('session:create-checkpoint', async (event, sessionId: string, state: string) => {
        // Checkpoints aren't implemented in current system
    });

    // Get sessions by file path
    ipcMain.handle('sessions:get-by-file', async (event, workspaceId: string, filePath: string) => {
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
    ipcMain.handle('test:query-db', async (event, sql: string, params?: any[]) => {
        try {
            const { database } = await import('../database/PGLiteDatabaseWorker');
            const result = await database.query(sql, params);
            return result;
        } catch (error) {
            console.error('[SessionHandlers] Test query error:', error);
            return { error: String(error) };
        }
    });
}

export { sessionManager };

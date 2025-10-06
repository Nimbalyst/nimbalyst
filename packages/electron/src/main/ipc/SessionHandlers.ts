import { ipcMain } from 'electron';
import { SessionManager } from '@stravu/runtime/ai/server';
import type { AIProviderType } from '@stravu/runtime/ai/server/types';

// Initialize session manager
const sessionManager = new SessionManager();

export async function registerSessionHandlers() {
    // Initialize session manager
    await sessionManager.initialize();

    // Create session
    ipcMain.handle('session:create', async (event, filePath: string, type: string, source?: any) => {
        return await sessionManager.createSession(filePath, type as AIProviderType, source);
    });

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
}

export { sessionManager };

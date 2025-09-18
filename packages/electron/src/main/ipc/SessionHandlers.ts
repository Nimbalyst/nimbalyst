import { ipcMain } from 'electron';
import { SessionManager } from '@stravu/runtime/ai/server/SessionManager';

// Initialize session manager
const sessionManager = new SessionManager();

export async function registerSessionHandlers() {
    // Initialize session manager
    await sessionManager.initialize();

    // Create session
    ipcMain.handle('session:create', async (event, filePath: string, type: string, source?: any) => {
        return await sessionManager.createSession(filePath, type as any, source);
    });

    // Load session
    ipcMain.handle('session:load', async (event, sessionId: string) => {
        return await sessionManager.loadSession(sessionId);
    });

    // Save session
    ipcMain.handle('session:save', async (event, session: any) => {
        await sessionManager.saveSession(session);
    });

    // Delete session
    ipcMain.handle('session:delete', async (event, sessionId: string) => {
        await sessionManager.deleteSession(sessionId);
    });

    // Get active session
    ipcMain.handle('session:get-active', async (event, filePath: string) => {
        return await sessionManager.getActiveSession(filePath);
    });

    // Set active session
    ipcMain.handle('session:set-active', async (event, filePath: string, sessionId: string, type: string) => {
        await sessionManager.setActiveSession(filePath, sessionId, type as any);
    });

    // Check conflicts
    ipcMain.handle('session:check-conflicts', async (event, session: any, currentMarkdownHash: string) => {
        return await sessionManager.checkConflicts(session, currentMarkdownHash);
    });

    // Resolve conflict
    ipcMain.handle('session:resolve-conflict', async (event, session: any, resolution: string, newBaseHash?: string) => {
        await sessionManager.resolveConflict(session, resolution as any, newBaseHash);
    });

    // Create checkpoint
    ipcMain.handle('session:create-checkpoint', async (event, sessionId: string, state: string) => {
        await sessionManager.createCheckpoint(sessionId, state);
    });
}

export { sessionManager };

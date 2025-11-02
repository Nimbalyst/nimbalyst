import { ipcMain } from 'electron';
import { HistoryManager } from '../HistoryManager';

// Initialize history manager
const historyManager = new HistoryManager();

export async function registerHistoryHandlers() {
    // Initialize history manager
    await historyManager.initialize();

    // Create snapshot
    ipcMain.handle('history:create-snapshot', async (event, filePath: string, state: string, type: string, description?: string) => {
        try {
            await historyManager.createSnapshot(filePath, state, type as any, description);
        } catch (error) {
            console.error('[HistoryHandlers] Failed to create snapshot:', error);
            throw error;
        }
    });

    // List snapshots
    ipcMain.handle('history:list-snapshots', async (event, filePath: string) => {
        return await historyManager.listSnapshots(filePath);
    });

    // Load snapshot
    ipcMain.handle('history:load-snapshot', async (event, filePath: string, timestamp: string) => {
        return await historyManager.loadSnapshot(filePath, timestamp);
    });

    // Delete snapshot
    ipcMain.handle('history:delete-snapshot', async (event, filePath: string, timestamp: string) => {
        await historyManager.deleteSnapshot(filePath, timestamp);
    });

    // PHASE 4/5: Get pending AI edit tags
    ipcMain.handle('history:get-pending-tags', async (event, filePath?: string) => {
        return await historyManager.getPendingTags(filePath);
    });

    // PHASE 5: Create tag (for testing)
    ipcMain.handle('history:create-tag', async (event, filePath: string, tagId: string, content: string, sessionId: string, toolUseId: string) => {
        await historyManager.createTag(filePath, tagId, content, sessionId, toolUseId);
    });

    // PHASE 5: Get tag (for testing)
    ipcMain.handle('history:get-tag', async (event, filePath: string, tagId: string) => {
        return await historyManager.getTag(filePath, tagId);
    });

    // PHASE 5: Update tag status
    ipcMain.handle('history:update-tag-status', async (event, filePath: string, tagId: string, status: string) => {
        await historyManager.updateTagStatus(filePath, tagId, status as any);
    });

    // PHASE 5: Update tag content
    ipcMain.handle('history:update-tag-content', async (event, filePath: string, tagId: string, content: string) => {
        await historyManager.updateTagContent(filePath, tagId, content);
    });
}

export { historyManager };
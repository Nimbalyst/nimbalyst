import { ipcMain } from 'electron';
import { HistoryManager } from '../HistoryManager';

// Initialize history manager
const historyManager = new HistoryManager();

export async function registerHistoryHandlers() {
    // Initialize history manager
    await historyManager.initialize();

    // Create snapshot
    ipcMain.handle('history:create-snapshot', async (event, filePath: string, state: string, type: string, description?: string) => {
        await historyManager.createSnapshot(filePath, state, type as any, description);
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
}

export { historyManager };
import { BrowserWindow, ipcMain } from 'electron';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';
import { optimizedWorkspaceWatcher } from './OptimizedWorkspaceWatcher';

// Set up IPC handlers for folder expand/collapse events
export function registerWorkspaceWatcherHandlers() {
    ipcMain.handle('workspace-folder-expanded', async (event, folderPath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        const windowId = getWindowId(window);
        if (windowId === null) return;

        logger.workspaceWatcher.debug(`Folder expanded: ${folderPath}`);
        optimizedWorkspaceWatcher.addWatchedFolder(windowId, folderPath);
    });

    ipcMain.handle('workspace-folder-collapsed', async (event, folderPath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        const windowId = getWindowId(window);
        if (windowId === null) return;

        logger.workspaceWatcher.debug(`Folder collapsed: ${folderPath}`);
        optimizedWorkspaceWatcher.removeWatchedFolder(windowId, folderPath);
    });
}

// Start watching a workspace directory for changes
export function startWorkspaceWatcher(window: BrowserWindow, workspacePath: string) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.workspaceWatcher.error('Failed to find custom window ID');
        return;
    }

    // Use optimized chokidar-based workspace watcher
    logger.workspaceWatcher.info('Using OptimizedWorkspaceWatcher for:', workspacePath);
    optimizedWorkspaceWatcher.start(window, workspacePath);
}

// Stop watching a workspace
export function stopWorkspaceWatcher(windowId: number) {
    optimizedWorkspaceWatcher.stop(windowId);
}

// Get workspace watcher info for debugging
export function getWorkspaceWatcherInfo(windowId: number): any {
    return optimizedWorkspaceWatcher.getStats();
}

// Restart the workspace watcher
export function restartWorkspaceWatcher(window: BrowserWindow, workspacePath: string) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.workspaceWatcher.error('Failed to find custom window ID');
        return;
    }
    logger.workspaceWatcher.info(`Restarting workspace watcher for: ${workspacePath}`);

    // Stop existing watcher
    stopWorkspaceWatcher(windowId);

    // Start new watcher
    startWorkspaceWatcher(window, workspacePath);
}

// Stop all workspace watchers (used during app quit)
export async function stopAllWorkspaceWatchers() {
    console.log('[WorkspaceWatcher] stopAllWorkspaceWatchers called');
    logger.workspaceWatcher.info('Stopping all workspace watchers');
    try {
        await optimizedWorkspaceWatcher.stopAll();
        console.log('[WorkspaceWatcher] stopAll completed');
    } catch (error) {
        console.error('[WorkspaceWatcher] Error in stopAll:', error);
        throw error;
    }
}

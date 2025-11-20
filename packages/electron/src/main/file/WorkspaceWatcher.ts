import { BrowserWindow, ipcMain } from 'electron';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId, windowStates } from '../window/WindowManager';
import { optimizedWorkspaceWatcher } from './OptimizedWorkspaceWatcher';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { readdirSync } from 'fs';
import path from "path";

// Helper function to calculate folder depth relative to workspace
function calculateFolderDepth(folderPath: string, workspacePath: string): number {
    const relativePath = path.relative(path.normalize(folderPath), path.normalize(workspacePath));
    if (!relativePath) return 0;
    const depth =  relativePath.split(path.sep).length;
    console.log(`[WorkspaceWatcher] Calculated folder depth: ${depth} for folderPath: ${folderPath} relative to workspacePath: ${workspacePath}`);
    return depth;
}

// Helper function to bucket file counts
function bucketFileCount(count: number): string {
    if (count <= 10) return '1-10';
    if (count <= 50) return '11-50';
    if (count <= 100) return '51-100';
    return '100+';
}

// Set up IPC handlers for folder expand/collapse events
export function registerWorkspaceWatcherHandlers() {
    ipcMain.handle('workspace-folder-expanded', async (event, folderPath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        const windowId = getWindowId(window);
        if (windowId === null) return;

        logger.workspaceWatcher.debug(`Folder expanded: ${folderPath}`);
        optimizedWorkspaceWatcher.addWatchedFolder(windowId, folderPath);

        // Track folder expansion analytics
        try {
            const state = windowStates.get(windowId);
            if (state?.workspacePath) {
                // Calculate depth
                const depth = calculateFolderDepth(folderPath, state.workspacePath);

                // Count files in the expanded folder
                let fileCount = 0;
                try {
                    const entries = readdirSync(folderPath, { withFileTypes: true });
                    fileCount = entries.filter(entry => entry.isFile()).length;
                } catch (error) {
                    // Ignore count errors
                }

                const analytics = AnalyticsService.getInstance();
                analytics.sendEvent('workspace_file_tree_expanded', {
                    depth,
                    fileCount: bucketFileCount(fileCount),
                });
            }
        } catch (error) {
            logger.workspaceWatcher.error('Error tracking workspace_file_tree_expanded event:', error);
        }
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
    // logger.workspaceWatcher.info('Using OptimizedWorkspaceWatcher for:', workspacePath);
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

import { BrowserWindow } from 'electron';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';
import { simpleWorkspaceWatcher } from './SimpleWorkspaceWatcher.ts';

// Start watching a workspace directory for changes
export function startWorkspaceWatcher(window: BrowserWindow, workspacePath: string) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.workspaceWatcher.error('Failed to find custom window ID');
        return;
    }

    // Use simple workspace watcher instead of chokidar due to FSEvents issues
    logger.workspaceWatcher.info('Using SimpleWorkspaceWatcher for:', workspacePath);
    simpleWorkspaceWatcher.start(window, workspacePath);
}

// Stop watching a workspace
export function stopWorkspaceWatcher(windowId: number) {
    simpleWorkspaceWatcher.stop(windowId);
}

// Get workspace watcher info for debugging
export function getWorkspaceWatcherInfo(windowId: number): any {
    // SimpleWorkspaceWatcher doesn't expose internal state, return basic info
    return {
        type: 'SimpleWorkspaceWatcher',
        windowId
    };
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
export function stopAllWorkspaceWatchers() {
    console.log('[WorkspaceWatcher] stopAllWorkspaceWatchers called');
    logger.workspaceWatcher.info('Stopping all workspace watchers');
    try {
        simpleWorkspaceWatcher.stopAll();
        console.log('[WorkspaceWatcher] stopAll completed');
    } catch (error) {
        console.error('[WorkspaceWatcher] Error in stopAll:', error);
        throw error;
    }
}

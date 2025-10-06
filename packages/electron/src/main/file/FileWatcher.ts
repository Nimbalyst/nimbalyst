import { BrowserWindow } from 'electron';
import { getWindowId } from '../window/WindowManager';
import { logger } from '../utils/logger';
import { chokidarFileWatcher } from './ChokidarFileWatcher';

// Start watching a file for changes
export async function startFileWatcher(window: BrowserWindow, filePath: string): Promise<void> {
    // Skip watching virtual documents
    if (filePath.startsWith('virtual://')) {
        logger.fileWatcher.debug('Skipping file watcher for virtual document:', filePath);
        return;
    }

    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.fileWatcher.error('Failed to find custom window ID');
        return;
    }

    // Use chokidar for reliable atomic save handling
    // logger.fileWatcher.info('Using ChokidarFileWatcher for:', filePath);
    await chokidarFileWatcher.start(window, filePath);
}

// Stop watching a file
export function stopFileWatcher(windowId: number) {
    chokidarFileWatcher.stop(windowId);
}

// Get file watcher info for debugging
export function getFileWatcherInfo(windowId: number): any {
    return chokidarFileWatcher.getStats();
}

// Check file for changes manually
export async function checkFileForChanges(window: BrowserWindow, filePath: string): Promise<void> {
    logger.fileWatcher.debug(`Manual check for file changes: ${filePath}`);
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.fileWatcher.error('Failed to find custom window ID');
        return;
    }

    // Restart the watcher to ensure it picks up changes
    stopFileWatcher(windowId);
    await startFileWatcher(window, filePath);
}

// Stop all file watchers (used during app quit)
export function stopAllFileWatchers() {
    console.log('[FileWatcher] stopAllFileWatchers called');
    logger.fileWatcher.info('Stopping all file watchers');
    try {
        chokidarFileWatcher.stopAll();
        console.log('[FileWatcher] stopAll completed');
    } catch (error) {
        console.error('[FileWatcher] Error in stopAll:', error);
        throw error;
    }
}

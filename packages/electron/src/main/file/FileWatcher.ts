import { BrowserWindow } from 'electron';
import { getWindowId } from '../window/WindowManager';
import { logger } from '../utils/logger';
import { simpleFileWatcher } from './SimpleFileWatcher';

// Start watching a file for changes
export function startFileWatcher(window: BrowserWindow, filePath: string) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.fileWatcher.error('Failed to find custom window ID');
        return;
    }

    // Use simple file watcher instead of chokidar due to FSEvents issues
    // logger.fileWatcher.info('Using SimpleFileWatcher for:', filePath);
    simpleFileWatcher.start(window, filePath);
}

// Stop watching a file
export function stopFileWatcher(windowId: number) {
    simpleFileWatcher.stop(windowId);
}

// Get file watcher info for debugging
export function getFileWatcherInfo(windowId: number): any {
    // SimpleFileWatcher doesn't expose internal state, return basic info
    return {
        type: 'SimpleFileWatcher',
        windowId
    };
}

// Check file for changes manually
export function checkFileForChanges(window: BrowserWindow, filePath: string) {
    logger.fileWatcher.debug(`Manual check for file changes: ${filePath}`);
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.fileWatcher.error('Failed to find custom window ID');
        return;
    }

    // Restart the watcher to ensure it picks up changes
    stopFileWatcher(windowId);
    startFileWatcher(window, filePath);
}

// Stop all file watchers (used during app quit)
export function stopAllFileWatchers() {
    console.log('[FileWatcher] stopAllFileWatchers called');
    logger.fileWatcher.info('Stopping all file watchers');
    try {
        simpleFileWatcher.stopAll();
        console.log('[FileWatcher] stopAll completed');
    } catch (error) {
        console.error('[FileWatcher] Error in stopAll:', error);
        throw error;
    }
}

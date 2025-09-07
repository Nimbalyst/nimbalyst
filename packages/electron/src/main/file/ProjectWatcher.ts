import { BrowserWindow } from 'electron';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';
import { simpleProjectWatcher } from './SimpleProjectWatcher';

// Start watching a project directory for changes
export function startProjectWatcher(window: BrowserWindow, projectPath: string) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.projectWatcher.error('Failed to find custom window ID');
        return;
    }
    
    // Use simple project watcher instead of chokidar due to FSEvents issues
    logger.projectWatcher.info('Using SimpleProjectWatcher for:', projectPath);
    simpleProjectWatcher.start(window, projectPath);
}

// Stop watching a project
export function stopProjectWatcher(windowId: number) {
    simpleProjectWatcher.stop(windowId);
}

// Get project watcher info for debugging
export function getProjectWatcherInfo(windowId: number): any {
    // SimpleProjectWatcher doesn't expose internal state, return basic info
    return {
        type: 'SimpleProjectWatcher',
        windowId
    };
}

// Restart the project watcher
export function restartProjectWatcher(window: BrowserWindow, projectPath: string) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        logger.projectWatcher.error('Failed to find custom window ID');
        return;
    }
    logger.projectWatcher.info(`Restarting project watcher for: ${projectPath}`);
    
    // Stop existing watcher
    stopProjectWatcher(windowId);
    
    // Start new watcher
    startProjectWatcher(window, projectPath);
}
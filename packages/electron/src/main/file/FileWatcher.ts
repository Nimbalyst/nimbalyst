import { BrowserWindow, dialog } from 'electron';
import * as chokidar from 'chokidar';
import { windowStates, savingWindows } from '../window/WindowManager';
import { FILE_WATCHER_POLL_INTERVAL, FILE_WATCHER_STABILITY_THRESHOLD } from '../utils/constants';
import { loadFileIntoWindow } from './FileOperations';
import { logger } from '../utils/logger';

// File watchers management
export const fileWatchers = new Map<number, chokidar.FSWatcher>();

// Start watching a file for changes
export function startFileWatcher(window: BrowserWindow, filePath: string) {
    const windowId = window.id;
    
    // Stop any existing watcher for this window
    stopFileWatcher(windowId);
    
    logger.fileWatcher.info(`Starting file watcher for: ${filePath} window: ${windowId}`);
    
    try {
        const watcher = chokidar.watch(filePath, {
            persistent: true,
            ignoreInitial: true,
            usePolling: true,  // Force polling for better reliability
            interval: FILE_WATCHER_POLL_INTERVAL,
            binaryInterval: FILE_WATCHER_POLL_INTERVAL, // Poll binary files at same rate
            awaitWriteFinish: {
                stabilityThreshold: FILE_WATCHER_STABILITY_THRESHOLD,
                pollInterval: 100
            },
            // Additional options for better detection
            alwaysStat: true,  // Get full stat results
            depth: 0,  // Only watch the specific file
            atomic: true  // Handle atomic writes better
        });
        
        // Add ready event to confirm watcher is active
        watcher.on('ready', () => {
            logger.fileWatcher.debug(`Watcher ready for: ${filePath}`);
        });
        
        watcher.on('add', (path) => {
            logger.fileWatcher.debug(`File added: ${path}`);
        });
        
        watcher.on('change', (path, stats) => {
            logger.fileWatcher.info(`File changed on disk: ${path}`, stats);
            
            // Check if we're currently saving this window
            if (savingWindows.has(windowId)) {
                logger.fileWatcher.debug('Ignoring change - window is currently saving');
                return;
            }
            
            const state = windowStates.get(windowId);
            logger.fileWatcher.debug('Window state:', state);
            
            if (state?.documentEdited) {
                logger.fileWatcher.info('Document has unsaved changes, showing dialog');
                // File has unsaved changes, ask user what to do
                const choice = dialog.showMessageBoxSync(window, {
                    type: 'question',
                    buttons: ['Keep My Changes', 'Load From Disk', 'Cancel'],
                    defaultId: 0,
                    cancelId: 2,
                    message: 'This file has been modified on disk. You have unsaved changes.\nWhat would you like to do?',
                    detail: `File: ${filePath}`
                });
                
                logger.fileWatcher.debug(`User choice: ${choice}`);
                
                if (choice === 1) {
                    // Load from disk
                    logger.fileWatcher.info('Loading file from disk');
                    loadFileIntoWindow(window, filePath);
                }
                // choice === 0 or 2: keep current changes
            } else {
                // No unsaved changes, just reload
                logger.fileWatcher.info('No unsaved changes, reloading file');
                loadFileIntoWindow(window, filePath);
            }
        });
        
        watcher.on('unlink', (path) => {
            logger.fileWatcher.warn(`File deleted: ${path}`);
            window.webContents.send('file-deleted', { filePath });
        });
        
        // Handle file rename/move
        watcher.on('error', (error) => {
            logger.fileWatcher.error('File watcher error:', error);
        });
        
        watcher.on('raw', (event, path, details) => {
            // logger.fileWatcher.silly(`Raw event: ${event} ${path}`, details);
        });
        
        fileWatchers.set(windowId, watcher);
        logger.fileWatcher.debug(`Watcher stored for window: ${windowId}`);
        
        // Log what files are being watched after a short delay
        setTimeout(() => {
            const watched = watcher.getWatched();
            // logger.fileWatcher.silly('Currently watching:', watched);
        }, 1000);
        
    } catch (error) {
        logger.fileWatcher.error('Failed to create watcher:', error);
    }
}

// Stop watching a file
export function stopFileWatcher(windowId: number) {
    const watcher = fileWatchers.get(windowId);
    if (watcher) {
        logger.fileWatcher.info(`Stopping file watcher for window: ${windowId}`);
        watcher.close();
        fileWatchers.delete(windowId);
    } else {
        logger.fileWatcher.debug(`No watcher found for window: ${windowId}`);
    }
}

// Get file watcher info for debugging
export function getFileWatcherInfo(windowId: number): any {
    const watcher = fileWatchers.get(windowId);
    if (watcher) {
        const watched = watcher.getWatched();
        return {
            path: Object.keys(watched)[0] || 'unknown',
            watched,
            usePolling: true,
            interval: FILE_WATCHER_POLL_INTERVAL
        };
    }
    return null;
}

// Check file for changes manually
export function checkFileForChanges(window: BrowserWindow, filePath: string) {
    logger.fileWatcher.debug(`Manual check for file changes: ${filePath}`);
    const windowId = window.id;
    
    // Restart the watcher to ensure it picks up changes
    stopFileWatcher(windowId);
    startFileWatcher(window, filePath);
}
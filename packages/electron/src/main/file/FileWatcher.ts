import { BrowserWindow, dialog } from 'electron';
import * as chokidar from 'chokidar';
import { windowStates, savingWindows } from '../window/WindowManager';
import { FILE_WATCHER_POLL_INTERVAL, FILE_WATCHER_STABILITY_THRESHOLD } from '../utils/constants';
import { loadFileIntoWindow } from './FileOperations';

// File watchers management
const fileWatchers = new Map<number, chokidar.FSWatcher>();

// Start watching a file for changes
export function startFileWatcher(window: BrowserWindow, filePath: string) {
    const windowId = window.id;
    
    // Stop any existing watcher for this window
    stopFileWatcher(windowId);
    
    console.log('[FILE_WATCHER] Starting file watcher for:', filePath, 'window:', windowId);
    
    try {
        const watcher = chokidar.watch(filePath, {
            persistent: true,
            ignoreInitial: true,
            usePolling: true,  // Use polling instead of native fsevents
            interval: FILE_WATCHER_POLL_INTERVAL,
            awaitWriteFinish: {
                stabilityThreshold: FILE_WATCHER_STABILITY_THRESHOLD,
                pollInterval: 100
            }
        });
        
        // Add ready event to confirm watcher is active
        watcher.on('ready', () => {
            console.log('[FILE_WATCHER] Watcher ready for:', filePath);
        });
        
        watcher.on('add', (path) => {
            console.log('[FILE_WATCHER] File added:', path);
        });
        
        watcher.on('change', (path, stats) => {
            console.log('[FILE_WATCHER] File changed on disk:', path, 'stats:', stats);
            
            // Check if we're currently saving this window
            if (savingWindows.has(windowId)) {
                console.log('[FILE_WATCHER] Ignoring change - window is currently saving');
                return;
            }
            
            const state = windowStates.get(windowId);
            console.log('[FILE_WATCHER] Window state:', state);
            
            if (state?.documentEdited) {
                console.log('[FILE_WATCHER] Document has unsaved changes, showing dialog');
                // File has unsaved changes, ask user what to do
                const choice = dialog.showMessageBoxSync(window, {
                    type: 'question',
                    buttons: ['Keep My Changes', 'Load From Disk', 'Cancel'],
                    defaultId: 0,
                    cancelId: 2,
                    message: 'This file has been modified on disk. You have unsaved changes.\nWhat would you like to do?',
                    detail: `File: ${filePath}`
                });
                
                console.log('[FILE_WATCHER] User choice:', choice);
                
                if (choice === 1) {
                    // Load from disk
                    console.log('[FILE_WATCHER] Loading file from disk');
                    loadFileIntoWindow(window, filePath);
                }
                // choice === 0 or 2: keep current changes
            } else {
                // No unsaved changes, just reload
                console.log('[FILE_WATCHER] No unsaved changes, reloading file');
                loadFileIntoWindow(window, filePath);
            }
        });
        
        watcher.on('unlink', (path) => {
            console.log('[FILE_WATCHER] File deleted:', path);
            window.webContents.send('file-deleted', { filePath });
        });
        
        // Handle file rename/move
        watcher.on('error', (error) => {
            console.error('[FILE_WATCHER] File watcher error:', error);
        });
        
        watcher.on('raw', (event, path, details) => {
            // console.log('[FILE_WATCHER] Raw event:', event, path, details);
        });
        
        fileWatchers.set(windowId, watcher);
        console.log('[FILE_WATCHER] Watcher stored for window:', windowId);
        
        // Log what files are being watched after a short delay
        setTimeout(() => {
            const watched = watcher.getWatched();
            // console.log('[FILE_WATCHER] Currently watching:', watched);
        }, 1000);
        
    } catch (error) {
        console.error('[FILE_WATCHER] Failed to create watcher:', error);
    }
}

// Stop watching a file
export function stopFileWatcher(windowId: number) {
    const watcher = fileWatchers.get(windowId);
    if (watcher) {
        console.log('[FILE_WATCHER] Stopping file watcher for window:', windowId);
        watcher.close();
        fileWatchers.delete(windowId);
    } else {
        console.log('[FILE_WATCHER] No watcher found for window:', windowId);
    }
}
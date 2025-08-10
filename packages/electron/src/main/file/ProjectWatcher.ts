import { BrowserWindow } from 'electron';
import * as chokidar from 'chokidar';
import { getFolderContents } from '../utils/FileTree';

// Project watchers management  
export const projectWatchers = new Map<number, chokidar.FSWatcher>();

// Start watching a project directory for changes
export function startProjectWatcher(window: BrowserWindow, projectPath: string) {
    const windowId = window.id;
    
    // Stop any existing project watcher for this window
    stopProjectWatcher(windowId);
    
    console.log('[PROJECT_WATCHER] Starting project watcher for:', projectPath, 'window:', windowId);
    
    // Debounce timer for file tree updates
    let updateTimer: NodeJS.Timeout | null = null;
    const debounceUpdate = () => {
        if (updateTimer) {
            clearTimeout(updateTimer);
        }
        updateTimer = setTimeout(() => {
            const fileTree = getFolderContents(projectPath);
            window.webContents.send('project-file-tree-updated', { fileTree });
        }, 300); // Wait 300ms after last change before updating
    };
    
    try {
        const watcher = chokidar.watch(projectPath, {
            persistent: true,
            ignoreInitial: true,
            ignored: [
                /(^|[\/\\])\../, // ignore dotfiles
                /node_modules/,
                /\.git/,
                /\.DS_Store/
            ],
            depth: 10, // Limit depth to avoid deep recursion
            usePolling: true, // Force polling for better reliability
            interval: 1000, // Poll every second for project files
            binaryInterval: 2000, // Poll binary files less frequently
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100
            },
            // Additional options for better detection
            alwaysStat: true,  // Get full stat results
            atomic: true,  // Handle atomic writes better
            followSymlinks: false  // Don't follow symlinks to avoid loops
        });
        
        watcher.on('ready', () => {
            console.log('[PROJECT_WATCHER] Watcher ready for:', projectPath);
        });
        
        // Handle file/folder additions
        watcher.on('add', (path) => {
            console.log('[PROJECT_WATCHER] File added:', path);
            if (path.endsWith('.md') || path.endsWith('.markdown')) {
                debounceUpdate();
            }
        });
        
        watcher.on('addDir', (path) => {
            console.log('[PROJECT_WATCHER] Directory added:', path);
            debounceUpdate();
        });
        
        // Handle file/folder removals
        watcher.on('unlink', (path) => {
            console.log('[PROJECT_WATCHER] File removed:', path);
            if (path.endsWith('.md') || path.endsWith('.markdown')) {
                debounceUpdate();
            }
        });
        
        watcher.on('unlinkDir', (path) => {
            console.log('[PROJECT_WATCHER] Directory removed:', path);
            debounceUpdate();
        });
        
        // Handle errors
        watcher.on('error', (error) => {
            console.error('[PROJECT_WATCHER] Project watcher error:', error);
        });
        
        projectWatchers.set(windowId, watcher);
        console.log('[PROJECT_WATCHER] Watcher stored for window:', windowId);
        
    } catch (error) {
        console.error('[PROJECT_WATCHER] Failed to create watcher:', error);
    }
}

// Stop watching a project
export function stopProjectWatcher(windowId: number) {
    const watcher = projectWatchers.get(windowId);
    if (watcher) {
        console.log('[PROJECT_WATCHER] Stopping project watcher for window:', windowId);
        watcher.close();
        projectWatchers.delete(windowId);
    }
}

// Get project watcher info for debugging
export function getProjectWatcherInfo(windowId: number): any {
    const watcher = projectWatchers.get(windowId);
    if (watcher) {
        const watched = watcher.getWatched();
        const watchedCount = Object.keys(watched).reduce((count, dir) => {
            return count + (watched[dir]?.length || 0);
        }, Object.keys(watched).length);
        
        return {
            path: Object.keys(watched)[0] || 'unknown',
            watched: Object.keys(watched).length > 10 
                ? `${Object.keys(watched).length} directories` 
                : Object.keys(watched),
            watchedCount,
            usePolling: true,
            depth: 10
        };
    }
    return null;
}

// Restart the project watcher
export function restartProjectWatcher(window: BrowserWindow, projectPath: string) {
    const windowId = window.id;
    console.log('[PROJECT_WATCHER] Restarting project watcher for:', projectPath);
    
    // Stop existing watcher
    stopProjectWatcher(windowId);
    
    // Start new watcher
    startProjectWatcher(window, projectPath);
}
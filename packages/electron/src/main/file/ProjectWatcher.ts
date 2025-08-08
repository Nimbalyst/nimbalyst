import { BrowserWindow } from 'electron';
import * as chokidar from 'chokidar';
import { getFolderContents } from '../utils/FileTree';

// Project watchers management  
const projectWatchers = new Map<number, chokidar.FSWatcher>();

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
            usePolling: false, // Use native events for project watching
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100
            }
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
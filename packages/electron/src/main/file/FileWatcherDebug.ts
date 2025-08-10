import { BrowserWindow } from 'electron';
import * as chokidar from 'chokidar';
import { windowStates } from '../window/WindowManager';
import { getFolderContents } from '../utils/FileTree';

// Access to the file watchers from FileWatcher.ts
declare const fileWatchers: Map<number, chokidar.FSWatcher>;
// Access to the project watchers from ProjectWatcher.ts  
declare const projectWatchers: Map<number, chokidar.FSWatcher>;

// Get file watcher status for debugging
export function getFileWatcherStatus(windowId: number): string {
    const state = windowStates.get(windowId);
    const lines: string[] = [];
    
    lines.push('=== Window State ===');
    if (state) {
        lines.push(`Mode: ${state.mode}`);
        lines.push(`File Path: ${state.filePath || 'None'}`);
        lines.push(`Project Path: ${state.projectPath || 'None'}`);
        lines.push(`Document Edited: ${state.documentEdited}`);
    } else {
        lines.push('No window state found');
    }
    
    lines.push('\n=== File Watcher ===');
    try {
        // Import the maps dynamically to avoid circular dependencies
        const { getFileWatcherInfo } = require('./FileWatcher');
        const info = getFileWatcherInfo(windowId);
        if (info) {
            lines.push(`Status: Active`);
            lines.push(`Watching: ${info.path}`);
            lines.push(`Polling: ${info.usePolling ? 'Yes' : 'No'}`);
            if (info.usePolling) {
                lines.push(`Poll Interval: ${info.interval}ms`);
            }
            lines.push(`Files being watched: ${JSON.stringify(info.watched, null, 2)}`);
        } else {
            lines.push('Status: No active file watcher');
        }
    } catch (error) {
        lines.push(`Error getting file watcher info: ${error}`);
    }
    
    lines.push('\n=== Project Watcher ===');
    try {
        // Import the maps dynamically to avoid circular dependencies
        const { getProjectWatcherInfo } = require('./ProjectWatcher');
        const info = getProjectWatcherInfo(windowId);
        if (info) {
            lines.push(`Status: Active`);
            lines.push(`Watching: ${info.path}`);
            lines.push(`Polling: ${info.usePolling ? 'Yes' : 'No'}`);
            lines.push(`Depth: ${info.depth}`);
            lines.push(`Files/Dirs watched: ${info.watchedCount} items`);
        } else {
            lines.push('Status: No active project watcher');
        }
    } catch (error) {
        lines.push(`Error getting project watcher info: ${error}`);
    }
    
    lines.push('\n=== System Info ===');
    lines.push(`Platform: ${process.platform}`);
    lines.push(`Node Version: ${process.version}`);
    lines.push(`Electron Version: ${process.versions.electron}`);
    
    return lines.join('\n');
}

// Force refresh the project file tree
export function refreshProjectFileTree(window: BrowserWindow) {
    const windowId = window.id;
    const state = windowStates.get(windowId);
    
    if (state?.mode === 'project' && state.projectPath) {
        console.log('[DEBUG] Force refreshing file tree for:', state.projectPath);
        
        // Get fresh file tree
        const fileTree = getFolderContents(state.projectPath);
        
        // Send to renderer
        window.webContents.send('project-file-tree-updated', { fileTree });
        
        // Also trigger a re-watch to ensure watchers are properly set up
        try {
            const { restartProjectWatcher } = require('./ProjectWatcher');
            restartProjectWatcher(window, state.projectPath);
            console.log('[DEBUG] Project watcher restarted');
        } catch (error) {
            console.error('[DEBUG] Failed to restart project watcher:', error);
        }
    } else if (state?.filePath) {
        // For single file mode, trigger a reload check
        console.log('[DEBUG] Checking file for changes:', state.filePath);
        
        try {
            const { checkFileForChanges } = require('./FileWatcher');
            checkFileForChanges(window, state.filePath);
        } catch (error) {
            console.error('[DEBUG] Failed to check file changes:', error);
        }
    }
}
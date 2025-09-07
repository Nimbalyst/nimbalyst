import { BrowserWindow } from 'electron';
import { windowStates } from '../window/WindowManager';
import { getFolderContents } from '../utils/FileTree';
import { simpleFileWatcher } from './SimpleFileWatcher';
import { simpleProjectWatcher } from './SimpleProjectWatcher';

// Get global file watcher statistics
export function getGlobalFileWatcherStats() {
    const fileStats = simpleFileWatcher.getStats();
    const projectStats = simpleProjectWatcher.getStats();
    
    const lines: string[] = [];
    lines.push('=== File Watcher Statistics ===');
    lines.push(`Type: ${fileStats.type}`);
    lines.push(`Active file watchers: ${fileStats.activeWatchers}`);
    
    if (fileStats.watchers.length > 0) {
        lines.push('\nWatched files:');
        for (const watcher of fileStats.watchers) {
            lines.push(`  Window ${watcher.windowId}: ${watcher.filePath}`);
        }
    }
    
    lines.push('\n=== Project Watcher Statistics ===');
    lines.push(`Type: ${projectStats.type}`);
    lines.push(`Active project watchers: ${projectStats.activeProjects}`);
    
    if (projectStats.projects.length > 0) {
        lines.push('\nWatched projects:');
        for (const project of projectStats.projects) {
            lines.push(`  Window ${project.windowId}: ${project.projectPath}`);
            lines.push(`    Directories watched: ${project.directoriesWatched}`);
        }
    }
    
    // Add performance metrics
    lines.push('\n=== Performance Metrics ===');
    const memUsage = process.memoryUsage();
    lines.push(`Memory (RSS): ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
    lines.push(`Memory (Heap Used): ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    lines.push(`Memory (Heap Total): ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    
    const handles = (process as any)._getActiveHandles?.()?.length || 'N/A';
    lines.push(`Active handles: ${handles}`);
    
    return lines.join('\n');
}

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
    
    // Get file watcher info for this window
    const fileStats = simpleFileWatcher.getStats();
    const fileWatcher = fileStats.watchers.find(w => w.windowId === windowId);
    
    lines.push('\n=== File Watcher ===');
    if (fileWatcher) {
        lines.push(`Status: Active`);
        lines.push(`Type: ${fileStats.type}`);
        lines.push(`Watching: ${fileWatcher.filePath}`);
    } else {
        lines.push('Status: No active file watcher');
    }
    
    // Get project watcher info for this window
    const projectStats = simpleProjectWatcher.getStats();
    const projectWatcher = projectStats.projects.find(p => p.windowId === windowId);
    
    lines.push('\n=== Project Watcher ===');
    if (projectWatcher) {
        lines.push(`Status: Active`);
        lines.push(`Type: ${projectStats.type}`);
        lines.push(`Watching: ${projectWatcher.projectPath}`);
        lines.push(`Directories watched: ${projectWatcher.directoriesWatched}`);
    } else {
        lines.push('Status: No active project watcher');
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
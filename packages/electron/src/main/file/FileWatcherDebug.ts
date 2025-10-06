import { BrowserWindow } from 'electron';
import { windowStates } from '../window/WindowManager';
import { getFolderContents } from '../utils/FileTree';
import { simpleFileWatcher } from './SimpleFileWatcher';
import { simpleWorkspaceWatcher } from './SimpleWorkspaceWatcher.ts';
import { checkFileForChanges } from './FileWatcher';

// Get global file watcher statistics
export function getGlobalFileWatcherStats() {
    const fileStats = simpleFileWatcher.getStats();
    const workspaceStats = simpleWorkspaceWatcher.getStats();

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

    lines.push('\n=== Workspace Watcher Statistics ===');
    lines.push(`Type: ${workspaceStats.type}`);
    lines.push(`Active workspace watchers: ${workspaceStats.activeWorkspaces}`);

    if (workspaceStats.workspaces.length > 0) {
        lines.push('\nWatched workspaces:');
        for (const workspace of workspaceStats.workspaces) {
            lines.push(`  Window ${workspace.windowId}: ${workspace.workspacePath}`);
            lines.push(`    Directories watched: ${workspace.directoriesWatched}`);
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
        lines.push(`Workspace Path: ${state.workspacePath || 'None'}`);
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

    // Get workspace watcher info for this window
    const workspaceStats = simpleWorkspaceWatcher.getStats();
    const workspaceWatcher = workspaceStats.workspaces.find(p => p.windowId === windowId);

    lines.push('\n=== Workspace Watcher ===');
    if (workspaceWatcher) {
        lines.push(`Status: Active`);
        lines.push(`Type: ${workspaceStats.type}`);
        lines.push(`Watching: ${workspaceWatcher.workspacePath}`);
        lines.push(`Directories watched: ${workspaceWatcher.directoriesWatched}`);
    } else {
        lines.push('Status: No active workspace watcher');
    }

    lines.push('\n=== System Info ===');
    lines.push(`Platform: ${process.platform}`);
    lines.push(`Node Version: ${process.version}`);
    lines.push(`Electron Version: ${process.versions.electron}`);

    return lines.join('\n');
}

// Force refresh the workspace file tree
export function refreshWorkspaceFileTree(window: BrowserWindow) {
    const windowId = window.id;
    const state = windowStates.get(windowId);

    if (state?.mode === 'workspace' && state.workspacePath) {
        console.log('[DEBUG] Force refreshing file tree for:', state.workspacePath);

        // Get fresh file tree
        const fileTree = getFolderContents(state.workspacePath);

        // Send to renderer
        window.webContents.send('workspace-file-tree-updated', { fileTree });

        // Also trigger a re-watch to ensure watchers are properly set up
        try {
            const { restartWorkspaceWatcher } = require('./WorkspaceWatcher.ts');
            restartWorkspaceWatcher(window, state.workspacePath);
            console.log('[DEBUG] Workspace watcher restarted');
        } catch (error) {
            console.error('[DEBUG] Failed to restart workspace watcher:', error);
        }
    } else if (state?.filePath) {
        // For single file mode, trigger a reload check
        console.log('[DEBUG] Checking file for changes:', state.filePath);

        try {
            checkFileForChanges(window, state.filePath);
        } catch (error) {
            console.error('[DEBUG] Failed to check file changes:', error);
        }
    }
}

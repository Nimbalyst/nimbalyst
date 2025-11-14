import { BrowserWindow } from 'electron';
import { windowStates } from '../window/WindowManager';
import { getFolderContents } from '../utils/FileTree';
import { chokidarFileWatcher } from './FileWatcher';
import { checkFileForChanges } from './FileWatcher';
import { basename } from 'path';

// Get global file watcher statistics
export function getGlobalFileWatcherStats() {
    const fileStats = chokidarFileWatcher.getStats();

    const lines: string[] = [];
    lines.push('=== File Watcher Statistics (Chokidar) ===');
    lines.push(`Type: ${fileStats.type}`);
    lines.push(`Total active watchers: ${fileStats.activeWatchers}`);

    if (fileStats.watchers.length > 0) {
        lines.push('\nWatched files:');

        // Group by window
        const byWindow = new Map<number, string[]>();
        for (const watcher of fileStats.watchers) {
            if (!byWindow.has(watcher.windowId)) {
                byWindow.set(watcher.windowId, []);
            }
            byWindow.get(watcher.windowId)!.push(watcher.filePath);
        }

        for (const [windowId, files] of byWindow) {
            lines.push(`\n  Window ${windowId} (${files.length} files):`);
            for (const filePath of files) {
                lines.push(`    - ${basename(filePath)}`);
            }
        }
    } else {
        lines.push('\nNo active file watchers');
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

    // Get file watcher info for this window using ChokidarFileWatcher
    const fileStats = chokidarFileWatcher.getStats();
    const windowWatchers = fileStats.watchers.filter(w => w.windowId === windowId);

    lines.push('\n=== File Watchers (Chokidar) ===');
    lines.push(`Type: ${fileStats.type}`);
    lines.push(`Active watchers for this window: ${windowWatchers.length}`);

    if (windowWatchers.length > 0) {
        lines.push('\nWatching files:');
        for (const watcher of windowWatchers) {
            lines.push(`  - ${basename(watcher.filePath)}`);
            lines.push(`    Full path: ${watcher.filePath}`);
        }
    } else {
        lines.push('No active file watchers for this window');
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

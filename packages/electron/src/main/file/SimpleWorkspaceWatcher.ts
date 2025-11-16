import { BrowserWindow } from 'electron';
import { watch, FSWatcher } from 'fs';
import { join, dirname } from 'path';
import { readdir, stat } from 'fs/promises';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

// Simple workspace watcher using Node's fs.watch for directories
export class SimpleWorkspaceWatcher {
    private watchers = new Map<number, Map<string, FSWatcher>>();
    private updateTimers = new Map<number, NodeJS.Timeout>();
    private workspacePaths = new Map<number, string>();

    async start(window: BrowserWindow, workspacePath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.workspaceWatcher.error('Failed to find window ID');
            return;
        }

        this.stop(windowId);

        logger.workspaceWatcher.info(`Starting simple workspace watcher for: ${workspacePath}`);

        const dirWatchers = new Map<string, FSWatcher>();
        this.watchers.set(windowId, dirWatchers);
        this.workspacePaths.set(windowId, workspacePath);

        // Debounced update function
        const triggerUpdate = () => {
            const existingTimer = this.updateTimers.get(windowId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                logger.workspaceWatcher.debug('Updating file tree');
                const fileTree = getFolderContents(workspacePath);
                window.webContents.send('workspace-file-tree-updated', { fileTree });
            }, 300);
            // Keep a strong reference to ensure timers aren't garbage collected
            // Note: NOT calling unref() to ensure watcher stays active in tests

            this.updateTimers.set(windowId, timer);
        };

        // Recursively watch directories
        const watchDirectory = async (dirPath: string, depth: number = 0) => {
            // Limit depth to prevent watching too many directories
            if (depth > 3) return;

            // Skip certain directories
            const skipDirs = ['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next'];
            const dirName = dirPath.split('/').pop();
            if (dirName && skipDirs.includes(dirName)) {
                return;
            }

            try {
                // Watch this directory
                const watcher = watch(dirPath, { recursive: false }, (eventType, filename) => {
                    if (!filename) return;

                    // Watch all files and directories - filtering happens in the UI
                    // logger.workspaceWatcher.debug(`Change detected: ${eventType} ${filename} in ${dirPath}`);
                    triggerUpdate();

                    // If a new directory was created, watch it
                    if (eventType === 'rename' && !filename.includes('.')) {
                        const newPath = join(dirPath, filename);
                        stat(newPath).then(stats => {
                            if (stats.isDirectory()) {
                                watchDirectory(newPath, depth + 1);
                            }
                        }).catch(() => {
                            // File/dir was deleted, ignore
                        });
                    }
                });
                // Keep a strong reference to prevent garbage collection
                // Note: NOT calling unref() to ensure watcher stays active in tests

                dirWatchers.set(dirPath, watcher);

                // Watch subdirectories
                const entries = await readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && !skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                        await watchDirectory(join(dirPath, entry.name), depth + 1);
                    }
                }
            } catch (error) {
                logger.workspaceWatcher.error(`Failed to watch directory ${dirPath}:`, error);
            }
        };

        // Start watching from the workspace root
        await watchDirectory(workspacePath);

        logger.workspaceWatcher.info(`Simple workspace watcher started with ${dirWatchers.size} directories watched`);
    }

    stop(windowId: number) {
        const dirWatchers = this.watchers.get(windowId);
        if (dirWatchers) {
            for (const watcher of dirWatchers.values()) {
                watcher.close();
            }
            this.watchers.delete(windowId);
            this.workspacePaths.delete(windowId);
        }

        const timer = this.updateTimers.get(windowId);
        if (timer) {
            clearTimeout(timer);
            this.updateTimers.delete(windowId);
        }
    }

    stopAll() {
        logger.workspaceWatcher.info(`[CLEANUP] Stopping all workspace watchers (${this.watchers.size} windows)`);
        console.log(`[CLEANUP] SimpleWorkspaceWatcher.stopAll called with ${this.watchers.size} windows`);

        // Stop all watchers
        for (const [windowId, dirWatchers] of this.watchers.entries()) {
            logger.workspaceWatcher.debug(`Stopping ${dirWatchers.size} watchers for window ${windowId}`);
            console.log(`[CLEANUP] Stopping ${dirWatchers.size} dir watchers for window ${windowId}`);
            let closeCount = 0;
            for (const [path, watcher] of dirWatchers.entries()) {
                try {
                    // console.log(`[CLEANUP] Closing watcher for path: ${path}`);
                    watcher.close();
                    closeCount++;
                } catch (error) {
                    logger.workspaceWatcher.error(`Error closing watcher:`, error);
                    console.error(`[CLEANUP] Error closing watcher for ${path}:`, error);
                }
            }
            console.log(`[CLEANUP] Closed ${closeCount} watchers for window ${windowId}`);
        }
        this.watchers.clear();
        this.workspacePaths.clear();

        // Clear all timers
        for (const timer of this.updateTimers.values()) {
            clearTimeout(timer);
        }
        this.updateTimers.clear();
        console.log(`[CLEANUP] SimpleWorkspaceWatcher.stopAll complete`);
    }

    getStats() {
        const stats: Array<{windowId: number, workspacePath: string, directoriesWatched: number}> = [];
        for (const [windowId, workspacePath] of this.workspacePaths.entries()) {
            const dirWatchers = this.watchers.get(windowId);
            stats.push({
                windowId,
                workspacePath,
                directoriesWatched: dirWatchers?.size || 0
            });
        }
        return {
            type: 'SimpleWorkspaceWatcher (fs.watch)',
            activeWorkspaces: this.watchers.size,
            workspaces: stats
        };
    }
}

export const simpleWorkspaceWatcher = new SimpleWorkspaceWatcher();

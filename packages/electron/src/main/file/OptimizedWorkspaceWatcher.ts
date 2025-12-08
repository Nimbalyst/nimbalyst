import { BrowserWindow } from 'electron';
import chokidar, { FSWatcher } from 'chokidar';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

/**
 * Optimized workspace watcher using Chokidar
 *
 * Only watches folders that are currently expanded in the file tree UI.
 * This dramatically reduces CPU usage by not watching collapsed folders.
 */
export class OptimizedWorkspaceWatcher {
    private watchers = new Map<number, FSWatcher>();
    private updateTimers = new Map<number, NodeJS.Timeout>();
    private workspacePaths = new Map<number, string>();
    private watchedPaths = new Map<number, Set<string>>(); // Track which paths are being watched per window

    async start(window: BrowserWindow, workspacePath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.workspaceWatcher.error('Failed to find window ID');
            return;
        }

        this.stop(windowId);

        // logger.workspaceWatcher.info(`Starting optimized workspace watcher for: ${workspacePath}`);
        // console.log(`[WorkspaceWatcher] Starting watcher for: ${workspacePath}`);

        this.workspacePaths.set(windowId, workspacePath);
        this.watchedPaths.set(windowId, new Set([workspacePath])); // Start by watching the root

        // Debounced update function
        const triggerUpdate = () => {
            const existingTimer = this.updateTimers.get(windowId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                logger.workspaceWatcher.debug('Updating file tree');
                // console.log(`[WorkspaceWatcher] Triggering file tree update for window ${windowId}`);
                const fileTree = getFolderContents(workspacePath);

                if (!window || window.isDestroyed()) {
                    console.log(`[WorkspaceWatcher] Window destroyed, skipping file tree update`);
                    return;
                }

                window.webContents.send('workspace-file-tree-updated', { fileTree });
            }, 500); // 500ms debounce to reduce CPU load

            this.updateTimers.set(windowId, timer);
        };

        try {
            // Create a watcher that only watches directories explicitly added to watchedPaths
            const watcher = chokidar.watch(workspacePath, {
                // Performance settings - critical for avoiding CPU spikes!
                ignored: (path: string, stats?: any) => {
                    const relativePath = path.replace(workspacePath, '');

                    // Always ignore common build/dependency directories
                    if (relativePath.includes('/node_modules/') ||
                        relativePath.includes('/.git/') ||
                        relativePath.includes('/dist/') ||
                        relativePath.includes('/build/') ||
                        relativePath.includes('/out/') ||
                        relativePath.includes('/coverage/') ||
                        relativePath.includes('/.next/') ||
                        relativePath.includes('/.vscode/') ||
                        relativePath.includes('/.idea/') ||
                        relativePath.includes('/target/') ||
                        relativePath.includes('/worktrees/')) {
                        return true;
                    }

                    // Ignore OS files
                    if (relativePath.endsWith('.DS_Store') ||
                        relativePath.endsWith('Thumbs.db')) {
                        return true;
                    }

                    // Watch all files - filtering happens in the UI
                    return false;
                },

                // Don't fire events for initial scan
                ignoreInitial: true,

                // Follow symlinks (optional, set to false if you don't need it)
                followSymlinks: false,

                // Watch only 1 level deep to prevent recursive watching
                // Each added folder via watcher.add() will also watch 1 level deep
                depth: 1,

                // Use native filesystem events (more efficient than polling)
                usePolling: false,

                // Atomic write handling
                atomic: true,
                awaitWriteFinish: {
                    stabilityThreshold: 200,
                    pollInterval: 100
                },

                // Performance: don't track stats for every file
                alwaysStat: false,

                // Don't use interval-based polling
                interval: 300,
                binaryInterval: 500,
            });

            // Handle all events (add, change, unlink, addDir, unlinkDir)
            watcher
                .on('add', (path) => {
                    console.log(`[WorkspaceWatcher] *** FILE ADDED EVENT ***: ${path}`);
                    triggerUpdate();
                })
                .on('change', (path) => {
                    // console.log(`[WorkspaceWatcher] File changed: ${path}`);
                    // Send file-changed-on-disk event to renderer for editor updates
                    if (!window.isDestroyed()) {
                        window.webContents.send('file-changed-on-disk', { path });
                    }
                    triggerUpdate();
                })
                .on('unlink', (path) => {
                    console.log(`[WorkspaceWatcher] File deleted: ${path}`);
                    triggerUpdate();
                })
                .on('addDir', (path) => {
                    console.log(`[WorkspaceWatcher] Directory added: ${path}`);
                    triggerUpdate();
                })
                .on('unlinkDir', (path) => {
                    console.log(`[WorkspaceWatcher] Directory deleted: ${path}`);
                    triggerUpdate();
                })
                .on('ready', () => {
                    // console.log(`[WorkspaceWatcher] *** WATCHER READY *** for: ${workspacePath}`);
                })
                .on('error', (error) => {
                    logger.workspaceWatcher.error('Watcher error:', error);
                    console.error(`[WorkspaceWatcher] Error:`, error);
                });

            this.watchers.set(windowId, watcher);

            // logger.workspaceWatcher.info(`Optimized workspace watcher started for: ${workspacePath}`);
            // console.log(`[WorkspaceWatcher] Successfully created watcher for window ${windowId}`);

        } catch (error) {
            logger.workspaceWatcher.error('Failed to start workspace watcher:', error);
            console.error(`[WorkspaceWatcher] Failed to start:`, error);
        }
    }

    // Add a folder to watch (called when user expands a folder in the UI)
    addWatchedFolder(windowId: number, folderPath: string) {
        const watcher = this.watchers.get(windowId);
        const watchedPaths = this.watchedPaths.get(windowId);

        if (!watcher || !watchedPaths) {
            console.log(`[WorkspaceWatcher] No watcher found for window ${windowId}`);
            return;
        }

        if (watchedPaths.has(folderPath)) {
            console.log(`[WorkspaceWatcher] Already watching: ${folderPath}`);
            return;
        }

        console.log(`[WorkspaceWatcher] Adding watch for folder: ${folderPath}`);
        watcher.add(folderPath);
        watchedPaths.add(folderPath);
    }

    // Remove a folder from watch (called when user collapses a folder in the UI)
    removeWatchedFolder(windowId: number, folderPath: string) {
        const watcher = this.watchers.get(windowId);
        const watchedPaths = this.watchedPaths.get(windowId);

        if (!watcher || !watchedPaths) {
            return;
        }

        if (!watchedPaths.has(folderPath)) {
            return;
        }

        console.log(`[WorkspaceWatcher] Removing watch for folder: ${folderPath}`);
        watcher.unwatch(folderPath);
        watchedPaths.delete(folderPath);
    }

    stop(windowId: number) {
        const watcher = this.watchers.get(windowId);
        if (watcher) {
            console.log(`[WorkspaceWatcher] Stopping watcher for window ${windowId}`);
            watcher.close();
            this.watchers.delete(windowId);
            this.workspacePaths.delete(windowId);
            this.watchedPaths.delete(windowId);
        }

        const timer = this.updateTimers.get(windowId);
        if (timer) {
            clearTimeout(timer);
            this.updateTimers.delete(windowId);
        }
    }

    async stopAll() {
        logger.workspaceWatcher.info(`[CLEANUP] Stopping all workspace watchers (${this.watchers.size} windows)`);
        console.log(`[CLEANUP] OptimizedWorkspaceWatcher.stopAll called with ${this.watchers.size} windows`);

        const closePromises: Promise<void>[] = [];
        for (const [windowId, watcher] of this.watchers.entries()) {
            try {
                console.log(`[CLEANUP] Closing workspace watcher for window ${windowId}`);
                // Log what we're watching
                const watched = watcher.getWatched();
                const totalFiles = Object.values(watched).reduce((sum: number, files: any) => sum + files.length, 0);
                console.log(`[CLEANUP] Watcher for window ${windowId} is watching ${totalFiles} files in ${Object.keys(watched).length} directories`);
                closePromises.push(watcher.close());
            } catch (error) {
                logger.workspaceWatcher.error(`Error closing watcher for window ${windowId}:`, error);
                console.error(`[CLEANUP] Error closing workspace watcher for window ${windowId}:`, error);
            }
        }

        // Wait for all watchers to close with a timeout
        const allClosesPromise = Promise.all(closePromises);
        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log(`[CLEANUP] Workspace watcher close timed out after 1000ms, forcing cleanup`);
                resolve();
            }, 1000);
        });

        await Promise.race([allClosesPromise, timeoutPromise]);
        this.watchers.clear();
        this.workspacePaths.clear();

        // Clear all timers
        for (const timer of this.updateTimers.values()) {
            clearTimeout(timer);
        }
        this.updateTimers.clear();
        console.log(`[CLEANUP] OptimizedWorkspaceWatcher.stopAll complete`);
    }

    getStats() {
        const stats: Array<{windowId: number, workspacePath: string}> = [];
        for (const [windowId, workspacePath] of this.workspacePaths.entries()) {
            stats.push({
                windowId,
                workspacePath
            });
        }
        return {
            type: 'OptimizedWorkspaceWatcher (chokidar)',
            activeWorkspaces: this.watchers.size,
            workspaces: stats
        };
    }
}

export const optimizedWorkspaceWatcher = new OptimizedWorkspaceWatcher();

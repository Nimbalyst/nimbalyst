import { BrowserWindow } from 'electron';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';
import * as workspaceEventBus from './WorkspaceEventBus';

/**
 * Optimized workspace watcher.
 *
 * Subscribes to WorkspaceEventBus (which owns the single fs.watch/chokidar
 * watcher per workspace tree) and translates events into file tree updates
 * and file-changed-on-disk notifications for the renderer.
 */
export class OptimizedWorkspaceWatcher {
    private updateTimers = new Map<number, NodeJS.Timeout>();
    private workspacePaths = new Map<number, string>();
    private watchedPaths = new Map<number, Set<string>>();
    /** Subscriber IDs we've registered with the bus, keyed by windowId */
    private subscriberIds = new Map<number, string>();

    async start(window: BrowserWindow, workspacePath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.workspaceWatcher.error('Failed to find window ID');
            return;
        }

        this.stop(windowId);

        this.workspacePaths.set(windowId, workspacePath);
        this.watchedPaths.set(windowId, new Set([workspacePath]));

        // Debounced update function
        const triggerUpdate = () => {
            const existingTimer = this.updateTimers.get(windowId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                logger.workspaceWatcher.debug('Updating file tree');
                const fileTree = getFolderContents(workspacePath);

                if (!window || window.isDestroyed()) {
                    return;
                }

                window.webContents.send('workspace-file-tree-updated', { fileTree });
            }, 500);

            this.updateTimers.set(windowId, timer);
        };

        const subscriberId = `workspace-watcher-${windowId}`;
        this.subscriberIds.set(windowId, subscriberId);

        await workspaceEventBus.subscribe(workspacePath, subscriberId, {
            onChange: (filePath: string) => {
                // Content modification -- notify editors, do NOT rebuild file tree
                if (!window.isDestroyed()) {
                    window.webContents.send('file-changed-on-disk', { path: filePath });
                }
            },
            onAdd: (filePath: string) => {
                // Tree structure changed
                triggerUpdate();
                // Also send file-changed-on-disk so editors pick up external additions
                if (!window.isDestroyed()) {
                    window.webContents.send('file-changed-on-disk', { path: filePath });
                }
            },
            onUnlink: (filePath: string) => {
                // Tree structure changed
                triggerUpdate();
                // Also send file-changed-on-disk for deletions
                if (!window.isDestroyed()) {
                    window.webContents.send('file-changed-on-disk', { path: filePath });
                }
            },
        });
    }

    // ---------------------------------------------------------------
    // Folder expansion tracking
    // ---------------------------------------------------------------

    /**
     * Add a folder to watch (called when user expands a folder in the UI).
     *
     * On macOS/Windows this is a no-op for watching purposes because the
     * recursive fs.watch already covers the entire tree. We still track
     * the path so getStats() reports accurately.
     *
     * On Linux (chokidar) this adds the folder to the chokidar watcher.
     */
    addWatchedFolder(windowId: number, folderPath: string) {
        const watchedPaths = this.watchedPaths.get(windowId);
        const workspacePath = this.workspacePaths.get(windowId);

        if (!watchedPaths) {
            return;
        }

        // Guard: only watch folders within the workspace
        if (workspacePath && !folderPath.startsWith(workspacePath + '/') && folderPath !== workspacePath) {
            return;
        }

        if (watchedPaths.has(folderPath)) {
            return;
        }

        watchedPaths.add(folderPath);

        // Forward to bus for Linux chokidar expansion
        if (workspacePath) {
            workspaceEventBus.addWatchedPath(workspacePath, folderPath);
        }
    }

    /**
     * Remove a folder from watch (called when user collapses a folder in the UI).
     */
    removeWatchedFolder(windowId: number, folderPath: string) {
        const watchedPaths = this.watchedPaths.get(windowId);
        const workspacePath = this.workspacePaths.get(windowId);
        if (!watchedPaths || !watchedPaths.has(folderPath)) {
            return;
        }

        watchedPaths.delete(folderPath);

        if (workspacePath) {
            workspaceEventBus.removeWatchedPath(workspacePath, folderPath);
        }
    }

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------

    stop(windowId: number) {
        const subscriberId = this.subscriberIds.get(windowId);
        const workspacePath = this.workspacePaths.get(windowId);

        if (subscriberId && workspacePath) {
            workspaceEventBus.unsubscribe(workspacePath, subscriberId);
        }

        this.subscriberIds.delete(windowId);
        this.workspacePaths.delete(windowId);
        this.watchedPaths.delete(windowId);

        const timer = this.updateTimers.get(windowId);
        if (timer) {
            clearTimeout(timer);
            this.updateTimers.delete(windowId);
        }
    }

    async stopAll() {
        logger.workspaceWatcher.info(`[CLEANUP] Stopping all workspace watchers (${this.workspacePaths.size} windows)`);

        for (const windowId of [...this.subscriberIds.keys()]) {
            this.stop(windowId);
        }

        for (const timer of this.updateTimers.values()) {
            clearTimeout(timer);
        }
        this.updateTimers.clear();
    }

    getStats() {
        const stats: Array<{ windowId: number; workspacePath: string; watchedFolders: number }> = [];
        for (const [windowId, workspacePath] of this.workspacePaths.entries()) {
            const watchedPaths = this.watchedPaths.get(windowId);
            stats.push({
                windowId,
                workspacePath,
                watchedFolders: watchedPaths?.size ?? 0,
            });
        }

        const busStats = workspaceEventBus.getStats();
        return {
            type: busStats.type,
            activeWorkspaces: this.workspacePaths.size,
            workspaces: stats,
        };
    }
}

export const optimizedWorkspaceWatcher = new OptimizedWorkspaceWatcher();

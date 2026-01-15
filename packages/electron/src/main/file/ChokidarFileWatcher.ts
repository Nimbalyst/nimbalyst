import { BrowserWindow } from 'electron';
import chokidar, { FSWatcher } from 'chokidar';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

/**
 * File watcher using Chokidar for reliable atomic save handling
 *
 * Only watches individual files (not directories) to avoid CPU issues.
 * Chokidar handles atomic saves from editors like vim automatically.
 */
export class ChokidarFileWatcher {
    // Map<windowId, Map<filePath, FSWatcher>>
    private watchers = new Map<number, Map<string, FSWatcher>>();

    private notifyFileDeleted(window: BrowserWindow | null, filePath: string) {
        try {
            if (!window || window.isDestroyed()) {
                console.log(`[ChokidarFileWatcher] Window destroyed, skipping file-deleted event`);
                return;
            }

            const contents = window.webContents;
            if (!contents || contents.isDestroyed()) {
                console.log(`[ChokidarFileWatcher] webContents destroyed, skipping file-deleted event`);
                return;
            }

            console.log(`[ChokidarFileWatcher] Sending file-deleted event for: ${filePath}`);
            contents.send('file-deleted', { filePath });
        } catch (sendError) {
            console.error(`[ChokidarFileWatcher] Error sending file-deleted event:`, sendError);
        }
    }

    private async emitFileChanged(window: BrowserWindow, filePath: string) {
        try {
            if (!window || window.isDestroyed()) {
                return;
            }

            const contents = window.webContents;
            if (!contents || contents.isDestroyed()) {
                return;
            }

            // PRODUCTION LOG: Track file change detection
            // Import historyManager to check for pending tags
            try {
                const { historyManager } = await import('../HistoryManager');
                const pendingTags = await historyManager.getPendingTags(filePath);
                const hasPendingTag = pendingTags && pendingTags.length > 0;

                // console.log('[FILE CHANGE]', {
                //     file: require('path').basename(filePath),
                //     hasPendingTag,
                //     tagId: hasPendingTag ? pendingTags[0].id : undefined,
                // });
            } catch (err) {
                // If historyManager check fails, just log the file change
                console.log('[FILE CHANGE]', require('path').basename(filePath));
            }

            // logger.fileWatcher.info(`File changed: ${filePath}`);
            contents.send('file-changed-on-disk', { path: filePath });
        } catch (error) {
            logger.fileWatcher.error(`Error sending event:`, error);
        }
    }

    start(window: BrowserWindow, filePath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const windowId = getWindowId(window);
            if (windowId === null) {
                logger.fileWatcher.error('Failed to find window ID');
                reject(new Error('Failed to find window ID'));
                return;
            }

            // Get or create the window's file watcher map
            let windowWatchers = this.watchers.get(windowId);
            if (!windowWatchers) {
                windowWatchers = new Map();
                this.watchers.set(windowId, windowWatchers);
            }

            // Check if we're already watching this exact file for this window
            if (windowWatchers.has(filePath)) {
                resolve();
                return;
            }

            try {
                // Create a watcher for this specific file only (not a directory!)
                const watcher = chokidar.watch(filePath, {
                    ignoreInitial: true,   // Don't fire events for initial file state
                    persistent: true,      // Keep the process running
                    atomic: true,          // Handle atomic writes (vim-style saves)
                    usePolling: false,     // Use native fs.watch
                    awaitWriteFinish: {
                        // Reduced from 100ms to 10ms to detect AI edits faster
                        // AI edits are sequential, not atomic, so we want immediate detection
                        stabilityThreshold: 10,
                        pollInterval: 10
                    }
                });

                // Wait for watcher to be ready before resolving
                watcher.on('ready', () => {
                    resolve();
                });

                // Handle file changes
                watcher.on('change', () => {
                    this.emitFileChanged(window, filePath);
                });

                // Handle file deletion
                watcher.on('unlink', () => {
                    this.notifyFileDeleted(window, filePath);
                    this.stopFile(windowId, filePath);
                });

                // Handle errors
                watcher.on('error', (error) => {
                    logger.fileWatcher.error(`Watcher error for ${filePath}:`, error);
                    reject(error);
                });

                windowWatchers.set(filePath, watcher);
            } catch (error) {
                logger.fileWatcher.error('Failed to start watcher:', error);
                reject(error);
            }
        });
    }

    // Stop watching a specific file in a specific window
    stopFile(windowId: number, filePath: string) {
        const windowWatchers = this.watchers.get(windowId);
        if (!windowWatchers) {
            return;
        }

        const watcher = windowWatchers.get(filePath);
        if (watcher) {
            watcher.close();
            windowWatchers.delete(filePath);

            // Clean up the window's map if it's empty
            if (windowWatchers.size === 0) {
                this.watchers.delete(windowId);
            }
        }
    }

    // Stop watching all files for a specific window
    stop(windowId: number) {
        const windowWatchers = this.watchers.get(windowId);
        if (!windowWatchers) {
            return;
        }

        // Stop all watchers for this window
        for (const filePath of windowWatchers.keys()) {
            this.stopFile(windowId, filePath);
        }
    }

    async stopAll() {
        let totalWatchers = 0;
        for (const windowWatchers of this.watchers.values()) {
            totalWatchers += windowWatchers.size;
        }

        logger.fileWatcher.info(`[CLEANUP] Stopping all file watchers (${totalWatchers} active)`);
        console.log(`[CLEANUP] ChokidarFileWatcher.stopAll called with ${totalWatchers} watchers`);

        const closePromises: Promise<void>[] = [];
        for (const [windowId, windowWatchers] of this.watchers.entries()) {
            for (const [filePath, watcher] of windowWatchers.entries()) {
                try {
                    console.log(`[CLEANUP] Closing file watcher for window ${windowId}, file ${filePath}`);
                    closePromises.push(watcher.close());
                } catch (error) {
                    logger.fileWatcher.error(`Error closing watcher for window ${windowId}, file ${filePath}:`, error);
                    console.error(`[CLEANUP] Error closing file watcher for window ${windowId}, file ${filePath}:`, error);
                }
            }
        }

        // Wait for all watchers to close
        await Promise.all(closePromises);
        this.watchers.clear();

        console.log(`[CLEANUP] ChokidarFileWatcher.stopAll complete`);
    }

    getStats() {
        const stats: Array<{windowId: number, filePath: string}> = [];
        for (const [windowId, windowWatchers] of this.watchers.entries()) {
            for (const filePath of windowWatchers.keys()) {
                stats.push({ windowId, filePath });
            }
        }

        let totalWatchers = 0;
        for (const windowWatchers of this.watchers.values()) {
            totalWatchers += windowWatchers.size;
        }

        return {
            type: 'ChokidarFileWatcher',
            activeWatchers: totalWatchers,
            watchers: stats
        };
    }
}

export const chokidarFileWatcher = new ChokidarFileWatcher();
export default chokidarFileWatcher;

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

    private emitFileChanged(window: BrowserWindow, filePath: string) {
        try {
            if (!window || window.isDestroyed()) {
                console.log(`[ChokidarFileWatcher] Window destroyed, skipping event for: ${filePath}`);
                return;
            }

            const contents = window.webContents;
            if (!contents || contents.isDestroyed()) {
                console.log(`[ChokidarFileWatcher] webContents destroyed, skipping event for: ${filePath}`);
                return;
            }

            logger.fileWatcher.info(`File changed: ${filePath}`);
            console.log(`[ChokidarFileWatcher] Sending file-changed-on-disk event for: ${filePath}`);
            contents.send('file-changed-on-disk', { path: filePath });
        } catch (error) {
            console.error(`[ChokidarFileWatcher] Error sending event:`, error);
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
                console.log(`[ChokidarFileWatcher] Already watching ${filePath} for window ${windowId}, skipping`);
                resolve();
                return;
            }

            try {
                console.log(`[ChokidarFileWatcher] Setting up watcher for: ${filePath} (window ${windowId})`);
                console.log(`[ChokidarFileWatcher] Current watched files for window ${windowId}:`, Array.from(windowWatchers.keys()));

                // Create a watcher for this specific file only (not a directory!)
                const watcher = chokidar.watch(filePath, {
                    ignoreInitial: true,  // Don't fire events for initial file state
                    persistent: true,      // Keep the process running
                });

                // Wait for watcher to be ready before resolving
                watcher.on('ready', () => {
                    console.log(`[ChokidarFileWatcher] Watcher ready for: ${filePath}`);
                    resolve();
                });

                // Handle file changes
                watcher.on('change', (path) => {
                    console.log(`[ChokidarFileWatcher] *** CHANGE EVENT ***: ${path}`);
                    console.log(`[ChokidarFileWatcher] Window ID: ${windowId}, Expected path: ${filePath}`);
                    this.emitFileChanged(window, filePath);
                });

                // Handle file deletion
                watcher.on('unlink', (path) => {
                    console.log(`[ChokidarFileWatcher] File deleted: ${path}`);
                    this.notifyFileDeleted(window, filePath);
                    this.stopFile(windowId, filePath);
                });

                // Handle errors
                watcher.on('error', (error) => {
                    console.error(`[ChokidarFileWatcher] Watcher error for ${filePath}:`, error);
                    reject(error);
                });

                windowWatchers.set(filePath, watcher);
                // logger.fileWatcher.info(`Started chokidar watcher for: ${filePath}`);
                // console.log(`[ChokidarFileWatcher] Watcher successfully created for window ${windowId}, file: ${filePath}`);
            } catch (error) {
                logger.fileWatcher.error('Failed to start watcher:', error);
                console.error(`[ChokidarFileWatcher] Failed to start watcher:`, error);
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
            console.log(`[ChokidarFileWatcher] Stopping watcher for window ${windowId}, file: ${filePath}`);
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

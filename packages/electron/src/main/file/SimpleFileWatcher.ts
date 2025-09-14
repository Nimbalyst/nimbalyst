import { BrowserWindow } from 'electron';
import { watch, FSWatcher, statSync } from 'fs';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

// Simple file watcher using Node's fs.watch instead of chokidar
export class SimpleFileWatcher {
    private watchers = new Map<number, FSWatcher>();
    private filePaths = new Map<number, string>();
    private lastMtimes = new Map<number, number>();  // Track last modification times

    start(window: BrowserWindow, filePath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.fileWatcher.error('Failed to find window ID');
            return;
        }

        // Check if we're already watching this exact file for this window
        const existingPath = this.filePaths.get(windowId);
        if (existingPath === filePath) {
            // console.log(`[FileWatcher] Already watching ${filePath} for window ${windowId}, skipping restart`);
            return;
        }

        this.stop(windowId);

        try {
            // console.log(`[FileWatcher] Setting up watcher for: ${filePath} (window ${windowId})`);

            // Get initial mtime
            try {
                const stats = statSync(filePath);
                this.lastMtimes.set(windowId, stats.mtimeMs);
                // console.log(`[FileWatcher] Initial mtime for ${filePath}: ${stats.mtimeMs}`);
            } catch (err) {
                console.error(`[FileWatcher] Could not get initial mtime for ${filePath}:`, err);
            }

            const watcher = watch(filePath, { persistent: true }, (eventType, filename) => {
                // console.log(`[FileWatcher] Raw event detected: ${eventType} for ${filePath} (filename: ${filename})`);
                if (eventType === 'change') {
                    // Check if the file actually changed by comparing mtime
                    try {
                        const stats = statSync(filePath);
                        const lastMtime = this.lastMtimes.get(windowId) || 0;
                        // console.log(`[FileWatcher] Checking mtime: old=${lastMtime}, new=${stats.mtimeMs}, diff=${stats.mtimeMs - lastMtime}`);

                        if (stats.mtimeMs <= lastMtime) {
                            // console.log(`[FileWatcher] Ignoring duplicate change event (mtime unchanged)`);
                            return;
                        }

                        this.lastMtimes.set(windowId, stats.mtimeMs);
                    } catch (err) {
                        console.error(`[FileWatcher] Could not check mtime:`, err);
                    }

                    logger.fileWatcher.info(`File changed: ${filePath}`);
                    console.log(`[FileWatcher] Sending file-changed-on-disk event for: ${filePath}`);
                    try {
                        if (window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed()) {
                            window.webContents.send('file-changed-on-disk', { path: filePath });
                            // console.log(`[FileWatcher] Event sent successfully`);
                        } else {
                            console.log(`[FileWatcher] Window or webContents is destroyed, cannot send event`);
                        }
                    } catch (error) {
                        console.error(`[FileWatcher] Error sending event:`, error);
                    }
                } else if (eventType === 'rename') {
                    // console.log(`[FileWatcher] File renamed: ${filePath}`);
                }
            });

            // Keep a strong reference to prevent garbage collection
            // Note: We're NOT calling unref() anymore to ensure the watcher stays active

            this.watchers.set(windowId, watcher);
            this.filePaths.set(windowId, filePath);
            logger.fileWatcher.info(`Started simple watcher for: ${filePath}`);
            // console.log(`[FileWatcher] Watcher successfully created and stored for window ${windowId}`);
        } catch (error) {
            logger.fileWatcher.error('Failed to start watcher:', error);
        }
    }

    stop(windowId: number) {
        const watcher = this.watchers.get(windowId);
        const filePath = this.filePaths.get(windowId);
        if (watcher) {
            // console.log(`[FileWatcher] Stopping watcher for window ${windowId}, file: ${filePath}`);
            watcher.close();
            this.watchers.delete(windowId);
            this.filePaths.delete(windowId);
            this.lastMtimes.delete(windowId);
        } else {
            console.log(`[FileWatcher] No watcher to stop for window ${windowId}`);
        }
    }

    stopAll() {
        logger.fileWatcher.info(`[CLEANUP] Stopping all file watchers (${this.watchers.size} active)`);
        console.log(`[CLEANUP] SimpleFileWatcher.stopAll called with ${this.watchers.size} watchers`);
        for (const [windowId, watcher] of this.watchers.entries()) {
            try {
                // console.log(`[CLEANUP] Closing file watcher for window ${windowId}`);
                watcher.close();
                // console.log(`[CLEANUP] Successfully closed file watcher for window ${windowId}`);
            } catch (error) {
                logger.fileWatcher.error(`Error closing watcher for window ${windowId}:`, error);
                console.error(`[CLEANUP] Error closing file watcher for window ${windowId}:`, error);
            }
        }
        this.watchers.clear();
        this.filePaths.clear();
        console.log(`[CLEANUP] SimpleFileWatcher.stopAll complete`);
    }

    getStats() {
        const stats: Array<{windowId: number, filePath: string}> = [];
        for (const [windowId, filePath] of this.filePaths.entries()) {
            stats.push({ windowId, filePath });
        }
        return {
            type: 'SimpleFileWatcher (fs.watch)',
            activeWatchers: this.watchers.size,
            watchers: stats
        };
    }
}

export const simpleFileWatcher = new SimpleFileWatcher();
export default simpleFileWatcher;

import { BrowserWindow } from 'electron';
import { watch, FSWatcher, statSync, existsSync } from 'fs';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

// Simple file watcher using Node's fs.watch instead of chokidar
export class SimpleFileWatcher {
    private watchers = new Map<number, FSWatcher>();
    private filePaths = new Map<number, string>();
    private lastMtimes = new Map<number, number>();  // Track last modification times
    private deletionCheckTimers = new Map<number, NodeJS.Timeout>();  // Timers to poll for file deletion

    private emitFileChanged(window: BrowserWindow, filePath: string) {
        try {
            if (!window || window.isDestroyed()) {
                console.log(`[FileWatcher] Window destroyed, skipping event for: ${filePath}`);
                return;
            }

            const contents = window.webContents;
            if (!contents || contents.isDestroyed()) {
                console.log(`[FileWatcher] webContents destroyed, skipping event for: ${filePath}`);
                return;
            }

            logger.fileWatcher.info(`File changed: ${filePath}`);
            console.log(`[FileWatcher] Sending file-changed-on-disk event for: ${filePath}`);
            contents.send('file-changed-on-disk', { path: filePath });
        } catch (error) {
            console.error(`[FileWatcher] Error sending event:`, error);
        }
    }

    private restartWatcher(window: BrowserWindow, windowId: number, filePath: string) {
        // Restart asynchronously so we exit the fs.watch callback first
        const timer = setTimeout(() => {
            if (!window || window.isDestroyed()) {
                return;
            }

            // Only restart if this window is still interested in the same file
            const trackedPath = this.filePaths.get(windowId);
            if (trackedPath && trackedPath !== filePath) {
                return;
            }

            // start() will stop any existing watcher for this windowId
            this.start(window, filePath);
        }, 10);
        try { (timer as any).unref?.(); } catch (_) {}
    }

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

            const watcher = watch(filePath, { persistent: true }, (eventType) => {
                // console.log(`[FileWatcher] Raw event detected: ${eventType} for ${filePath}`);

                // First check if file still exists (catches deletions)
                if (!existsSync(filePath)) {
                    console.log(`[FileWatcher] File deleted (external): ${filePath}`);
                    // Send file-deleted event to notify renderer
                    try {
                        if (!window || window.isDestroyed()) {
                            console.log(`[FileWatcher] Window destroyed, skipping file-deleted event`);
                        } else {
                            const contents = window.webContents;
                            if (!contents || contents.isDestroyed()) {
                                console.log(`[FileWatcher] webContents destroyed, skipping file-deleted event`);
                            } else {
                                console.log(`[FileWatcher] Sending file-deleted event for: ${filePath}`);
                                contents.send('file-deleted', { filePath });
                            }
                        }
                    } catch (sendError) {
                        console.error(`[FileWatcher] Error sending file-deleted event:`, sendError);
                    }
                    this.stop(windowId);
                    return;
                }

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
                        this.emitFileChanged(window, filePath);
                    } catch (err) {
                        console.error(`[FileWatcher] Could not check mtime:`, err);
                    }
                } else if (eventType === 'rename') {
                    // console.log(`[FileWatcher] File renamed: ${filePath}`);
                    try {
                        const stats = statSync(filePath);
                        const lastMtime = this.lastMtimes.get(windowId) || 0;

                        if (stats.mtimeMs !== lastMtime) {
                            this.lastMtimes.set(windowId, stats.mtimeMs);
                        }

                        this.emitFileChanged(window, filePath);
                        this.restartWatcher(window, windowId, filePath);
                    } catch (error: any) {
                        if (error && error.code === 'ENOENT') {
                            console.log(`[FileWatcher] File deleted (external): ${filePath}`);
                            // Send file-deleted event to notify renderer
                            try {
                                if (!window || window.isDestroyed()) {
                                    console.log(`[FileWatcher] Window destroyed, skipping file-deleted event`);
                                } else {
                                    const contents = window.webContents;
                                    if (!contents || contents.isDestroyed()) {
                                        console.log(`[FileWatcher] webContents destroyed, skipping file-deleted event`);
                                    } else {
                                        console.log(`[FileWatcher] Sending file-deleted event for: ${filePath}`);
                                        contents.send('file-deleted', { filePath });
                                    }
                                }
                            } catch (sendError) {
                                console.error(`[FileWatcher] Error sending file-deleted event:`, sendError);
                            }
                            this.stop(windowId);
                        } else {
                            console.error(`[FileWatcher] Error handling rename event for ${filePath}:`, error);
                        }
                    }
                }
            });

            // Keep a strong reference to prevent garbage collection
            // Note: We're NOT calling unref() anymore to ensure the watcher stays active

            this.watchers.set(windowId, watcher);
            this.filePaths.set(windowId, filePath);
            logger.fileWatcher.info(`Started simple watcher for: ${filePath}`);
            // console.log(`[FileWatcher] Watcher successfully created and stored for window ${windowId}`);

            // Start polling for file deletion (since fs.watch is unreliable on macOS)
            const deletionCheckTimer = setInterval(() => {
                if (!existsSync(filePath)) {
                    console.log(`[FileWatcher] File deleted detected via polling: ${filePath}`);
                    clearInterval(deletionCheckTimer);
                    this.deletionCheckTimers.delete(windowId);

                    // Send file-deleted event to notify renderer
                    try {
                        if (!window || window.isDestroyed()) {
                            console.log(`[FileWatcher] Window destroyed, skipping file-deleted event`);
                        } else {
                            const contents = window.webContents;
                            if (!contents || contents.isDestroyed()) {
                                console.log(`[FileWatcher] webContents destroyed, skipping file-deleted event`);
                            } else {
                                console.log(`[FileWatcher] Sending file-deleted event for: ${filePath}`);
                                contents.send('file-deleted', { filePath });
                            }
                        }
                    } catch (sendError) {
                        console.error(`[FileWatcher] Error sending file-deleted event:`, sendError);
                    }
                    this.stop(windowId);
                }
            }, 1000); // Check every second

            this.deletionCheckTimers.set(windowId, deletionCheckTimer);
        } catch (error) {
            logger.fileWatcher.error('Failed to start watcher:', error);
        }
    }

    stop(windowId: number) {
        const watcher = this.watchers.get(windowId);
        const filePath = this.filePaths.get(windowId);
        const deletionCheckTimer = this.deletionCheckTimers.get(windowId);

        if (watcher) {
            // console.log(`[FileWatcher] Stopping watcher for window ${windowId}, file: ${filePath}`);
            watcher.close();
            this.watchers.delete(windowId);
            this.filePaths.delete(windowId);
            this.lastMtimes.delete(windowId);
        } else {
            console.log(`[FileWatcher] No watcher to stop for window ${windowId}`);
        }

        if (deletionCheckTimer) {
            clearInterval(deletionCheckTimer);
            this.deletionCheckTimers.delete(windowId);
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

        // Clear all deletion check timers
        for (const timer of this.deletionCheckTimers.values()) {
            clearInterval(timer);
        }
        this.deletionCheckTimers.clear();

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

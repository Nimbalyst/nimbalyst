import { BrowserWindow } from 'electron';
import { watch, FSWatcher, statSync, existsSync } from 'fs';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

// Simple file watcher using Node's fs.watch instead of chokidar
export class SimpleFileWatcher {
    // Change to support multiple files per window: Map<windowId, Map<filePath, FSWatcher>>
    private watchers = new Map<number, Map<string, FSWatcher>>();
    private lastMtimes = new Map<string, number>();  // Track last modification times by filePath
    private deletionCheckTimers = new Map<string, NodeJS.Timeout>();  // Timers by filePath
    private atomicSaveRetryTimers = new Map<string, NodeJS.Timeout>();

    private notifyFileDeleted(window: BrowserWindow | null, filePath: string) {
        try {
            if (!window || window.isDestroyed()) {
                console.log(`[FileWatcher] Window destroyed, skipping file-deleted event`);
                return;
            }

            const contents = window.webContents;
            if (!contents || contents.isDestroyed()) {
                console.log(`[FileWatcher] webContents destroyed, skipping file-deleted event`);
                return;
            }

            console.log(`[FileWatcher] Sending file-deleted event for: ${filePath}`);
            contents.send('file-deleted', { filePath });
        } catch (sendError) {
            console.error(`[FileWatcher] Error sending file-deleted event:`, sendError);
        }
    }

    private handlePotentialAtomicSave(window: BrowserWindow, windowId: number, filePath: string, attempt: number) {
        const maxAttempts = 5;
        const delay = Math.min(100 * (attempt + 1), 500);

        // Pause deletion polling while we retry (prevent false deletion events during atomic save)
        const deletionTimer = this.deletionCheckTimers.get(filePath);
        if (deletionTimer && attempt === 0) {
            console.log(`[FileWatcher] Pausing deletion polling during atomic save retry for: ${filePath}`);
            clearInterval(deletionTimer);
            this.deletionCheckTimers.delete(filePath);
        }

        const retryTimer = setTimeout(() => {
            this.atomicSaveRetryTimers.delete(filePath);

            try {
                if (existsSync(filePath)) {
                    const stats = statSync(filePath);
                    const lastMtime = this.lastMtimes.get(filePath) || 0;

                    if (stats.mtimeMs !== lastMtime) {
                        this.lastMtimes.set(filePath, stats.mtimeMs);
                    }

                    console.log(`[FileWatcher] Atomic save detected, treating as change for: ${filePath}`);
                    this.emitFileChanged(window, filePath);
                    this.restartWatcher(window, windowId, filePath);
                    return;
                }
            } catch (error: any) {
                if (!error || error.code !== 'ENOENT') {
                    console.error(`[FileWatcher] Error during atomic save retry for ${filePath}:`, error);
                }
            }

            if (attempt + 1 < maxAttempts) {
                console.log(`[FileWatcher] Atomic save retry ${attempt + 1} failed for ${filePath}, retrying...`);
                this.handlePotentialAtomicSave(window, windowId, filePath, attempt + 1);
                return;
            }

            console.log(`[FileWatcher] File deleted after atomic save retries: ${filePath}`);
            this.notifyFileDeleted(window, filePath);
            this.stopFile(windowId, filePath);
        }, delay);

        try { (retryTimer as any).unref?.(); } catch (_) {}
        this.atomicSaveRetryTimers.set(filePath, retryTimer);
    }

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

            console.log(`[FileWatcher] Restarting watcher for: ${filePath}`);
            // Must stop first, otherwise start() will see it's already watched and skip
            this.stopFile(windowId, filePath);
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

        // Get or create the window's file watcher map
        let windowWatchers = this.watchers.get(windowId);
        if (!windowWatchers) {
            windowWatchers = new Map();
            this.watchers.set(windowId, windowWatchers);
        }

        // Check if we're already watching this exact file for this window
        if (windowWatchers.has(filePath)) {
            console.log(`[FileWatcher] Already watching ${filePath} for window ${windowId}, skipping restart`);
            return;
        }

        try {
            // console.log(`[FileWatcher] Setting up watcher for: ${filePath} (window ${windowId})`);

            // Get initial mtime
            try {
                const stats = statSync(filePath);
                this.lastMtimes.set(filePath, stats.mtimeMs);
                // console.log(`[FileWatcher] Initial mtime for ${filePath}: ${stats.mtimeMs}`);
            } catch (err) {
                console.error(`[FileWatcher] Could not get initial mtime for ${filePath}:`, err);
            }

            const watcher = watch(filePath, { persistent: true }, (eventType) => {
                console.log(`[FileWatcher] Raw event detected: ${eventType} for ${filePath}`);

                // First check if file still exists (catches deletions)
                if (!existsSync(filePath)) {
                    console.log(`[FileWatcher] File deleted (external): ${filePath}`);
                    this.notifyFileDeleted(window, filePath);
                    this.stopFile(windowId, filePath);
                    return;
                }

                if (eventType === 'change') {
                    // Check if the file actually changed by comparing mtime
                    try {
                        const stats = statSync(filePath);
                        const lastMtime = this.lastMtimes.get(filePath) || 0;
                        console.log(`[FileWatcher] Checking mtime: old=${lastMtime}, new=${stats.mtimeMs}, diff=${stats.mtimeMs - lastMtime}`);

                        if (stats.mtimeMs <= lastMtime) {
                            console.log(`[FileWatcher] Ignoring duplicate change event (mtime unchanged)`);
                            return;
                        }

                        this.lastMtimes.set(filePath, stats.mtimeMs);
                        this.emitFileChanged(window, filePath);
                    } catch (err) {
                        console.error(`[FileWatcher] Could not check mtime:`, err);
                    }
                } else if (eventType === 'rename') {
                    console.log(`[FileWatcher] File renamed: ${filePath}`);
                    const processRename = () => {
                        try {
                            const stats = statSync(filePath);
                            const lastMtime = this.lastMtimes.get(filePath) || 0;

                            if (stats.mtimeMs !== lastMtime) {
                                this.lastMtimes.set(filePath, stats.mtimeMs);
                            }

                            this.emitFileChanged(window, filePath);
                            this.restartWatcher(window, windowId, filePath);
                        } catch (error: any) {
                            if (error && error.code === 'ENOENT') {
                                // Some editors (like vi) perform atomic saves by unlinking and then renaming.
                                // Give the filesystem a moment to settle before treating this as a deletion.
                                console.log(`[FileWatcher] Rename ENOENT for ${filePath}, retrying before marking deleted`);
                                this.handlePotentialAtomicSave(window, windowId, filePath, 0);
                            } else {
                                console.error(`[FileWatcher] Error handling rename event for ${filePath}:`, error);
                            }
                        }
                    };

                    processRename();
                }
            });

            // Keep a strong reference to prevent garbage collection
            // Note: We're NOT calling unref() anymore to ensure the watcher stays active

            windowWatchers.set(filePath, watcher);
            logger.fileWatcher.info(`Started simple watcher for: ${filePath}`);
            console.log(`[FileWatcher] Watcher successfully created and stored for window ${windowId}, file: ${filePath}`);

            // Start polling for file deletion (since fs.watch is unreliable on macOS)
            const deletionCheckTimer = setInterval(() => {
                if (!existsSync(filePath)) {
                    console.log(`[FileWatcher] File deleted detected via polling: ${filePath}`);
                    clearInterval(deletionCheckTimer);
                    this.deletionCheckTimers.delete(filePath);

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
                    this.stopFile(windowId, filePath);
                }
            }, 1000); // Check every second

            this.deletionCheckTimers.set(filePath, deletionCheckTimer);
        } catch (error) {
            logger.fileWatcher.error('Failed to start watcher:', error);
        }
    }

    // Stop watching a specific file in a specific window
    stopFile(windowId: number, filePath: string) {
        const windowWatchers = this.watchers.get(windowId);
        if (!windowWatchers) {
            return;
        }

        const watcher = windowWatchers.get(filePath);
        const deletionCheckTimer = this.deletionCheckTimers.get(filePath);
        const atomicSaveRetryTimer = this.atomicSaveRetryTimers.get(filePath);

        if (watcher) {
            // console.log(`[FileWatcher] Stopping watcher for window ${windowId}, file: ${filePath}`);
            watcher.close();
            windowWatchers.delete(filePath);
            this.lastMtimes.delete(filePath);

            // Clean up the window's map if it's empty
            if (windowWatchers.size === 0) {
                this.watchers.delete(windowId);
            }
        }

        if (deletionCheckTimer) {
            clearInterval(deletionCheckTimer);
            this.deletionCheckTimers.delete(filePath);
        }

        if (atomicSaveRetryTimer) {
            clearTimeout(atomicSaveRetryTimer);
            this.atomicSaveRetryTimers.delete(filePath);
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

    stopAll() {
        let totalWatchers = 0;
        for (const windowWatchers of this.watchers.values()) {
            totalWatchers += windowWatchers.size;
        }

        logger.fileWatcher.info(`[CLEANUP] Stopping all file watchers (${totalWatchers} active)`);
        console.log(`[CLEANUP] SimpleFileWatcher.stopAll called with ${totalWatchers} watchers`);

        for (const [windowId, windowWatchers] of this.watchers.entries()) {
            for (const [filePath, watcher] of windowWatchers.entries()) {
                try {
                    // console.log(`[CLEANUP] Closing file watcher for window ${windowId}, file ${filePath}`);
                    watcher.close();
                    // console.log(`[CLEANUP] Successfully closed file watcher for window ${windowId}, file ${filePath}`);
                } catch (error) {
                    logger.fileWatcher.error(`Error closing watcher for window ${windowId}, file ${filePath}:`, error);
                    console.error(`[CLEANUP] Error closing file watcher for window ${windowId}, file ${filePath}:`, error);
                }
            }
        }
        this.watchers.clear();
        this.lastMtimes.clear();

        // Clear all deletion check timers
        for (const timer of this.deletionCheckTimers.values()) {
            clearInterval(timer);
        }
        this.deletionCheckTimers.clear();

        // Clear atomic save retry timers
        for (const timer of this.atomicSaveRetryTimers.values()) {
            clearTimeout(timer);
        }
        this.atomicSaveRetryTimers.clear();

        console.log(`[CLEANUP] SimpleFileWatcher.stopAll complete`);
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
            type: 'SimpleFileWatcher (fs.watch)',
            activeWatchers: totalWatchers,
            watchers: stats
        };
    }
}

export const simpleFileWatcher = new SimpleFileWatcher();
export default simpleFileWatcher;

import { BrowserWindow } from 'electron';
import { watch, FSWatcher } from 'fs';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

// Simple file watcher using Node's fs.watch instead of chokidar
export class SimpleFileWatcher {
    private watchers = new Map<number, FSWatcher>();
    private filePaths = new Map<number, string>();

    start(window: BrowserWindow, filePath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.fileWatcher.error('Failed to find window ID');
            return;
        }

        this.stop(windowId);

        try {
            const watcher = watch(filePath, (eventType, filename) => {
                if (eventType === 'change') {
                    logger.fileWatcher.info(`File changed: ${filePath}`);
                    window.webContents.send('file-changed-on-disk', { path: filePath });
                }
            });
            // Do not keep the process alive because of watchers
            try { (watcher as any).unref?.(); } catch {}

            this.watchers.set(windowId, watcher);
            this.filePaths.set(windowId, filePath);
            // logger.fileWatcher.info(`Started simple watcher for: ${filePath}`);
        } catch (error) {
            logger.fileWatcher.error('Failed to start watcher:', error);
        }
    }

    stop(windowId: number) {
        const watcher = this.watchers.get(windowId);
        if (watcher) {
            watcher.close();
            this.watchers.delete(windowId);
            this.filePaths.delete(windowId);
        }
    }

    stopAll() {
        logger.fileWatcher.info(`[CLEANUP] Stopping all file watchers (${this.watchers.size} active)`);
        console.log(`[CLEANUP] SimpleFileWatcher.stopAll called with ${this.watchers.size} watchers`);
        for (const [windowId, watcher] of this.watchers.entries()) {
            try {
                console.log(`[CLEANUP] Closing file watcher for window ${windowId}`);
                watcher.close();
                console.log(`[CLEANUP] Successfully closed file watcher for window ${windowId}`);
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

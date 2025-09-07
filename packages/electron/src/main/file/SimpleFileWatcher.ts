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
            
            this.watchers.set(windowId, watcher);
            this.filePaths.set(windowId, filePath);
            logger.fileWatcher.info(`Started simple watcher for: ${filePath}`);
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
import { BrowserWindow } from 'electron';
import { watch, FSWatcher } from 'fs';
import { join, dirname } from 'path';
import { readdir, stat } from 'fs/promises';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

// Simple project watcher using Node's fs.watch for directories
export class SimpleProjectWatcher {
    private watchers = new Map<number, Map<string, FSWatcher>>();
    private updateTimers = new Map<number, NodeJS.Timeout>();
    private projectPaths = new Map<number, string>();
    
    async start(window: BrowserWindow, projectPath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.projectWatcher.error('Failed to find window ID');
            return;
        }
        
        this.stop(windowId);
        
        logger.projectWatcher.info(`Starting simple project watcher for: ${projectPath}`);
        
        const dirWatchers = new Map<string, FSWatcher>();
        this.watchers.set(windowId, dirWatchers);
        this.projectPaths.set(windowId, projectPath);
        
        // Debounced update function
        const triggerUpdate = () => {
            const existingTimer = this.updateTimers.get(windowId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            
            const timer = setTimeout(() => {
                logger.projectWatcher.debug('Updating file tree');
                const fileTree = getFolderContents(projectPath);
                window.webContents.send('project-file-tree-updated', { fileTree });
            }, 300);
            
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
                    
                    // Only care about markdown files and directories
                    if (filename.endsWith('.md') || filename.endsWith('.markdown') || !filename.includes('.')) {
                        logger.projectWatcher.debug(`Change detected: ${eventType} ${filename} in ${dirPath}`);
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
                    }
                });
                
                dirWatchers.set(dirPath, watcher);
                
                // Watch subdirectories
                const entries = await readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && !skipDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                        await watchDirectory(join(dirPath, entry.name), depth + 1);
                    }
                }
            } catch (error) {
                logger.projectWatcher.error(`Failed to watch directory ${dirPath}:`, error);
            }
        };
        
        // Start watching from the project root
        await watchDirectory(projectPath);
        
        logger.projectWatcher.info(`Simple project watcher started with ${dirWatchers.size} directories watched`);
    }
    
    stop(windowId: number) {
        const dirWatchers = this.watchers.get(windowId);
        if (dirWatchers) {
            for (const watcher of dirWatchers.values()) {
                watcher.close();
            }
            this.watchers.delete(windowId);
            this.projectPaths.delete(windowId);
        }
        
        const timer = this.updateTimers.get(windowId);
        if (timer) {
            clearTimeout(timer);
            this.updateTimers.delete(windowId);
        }
    }
    
    getStats() {
        const stats: Array<{windowId: number, projectPath: string, directoriesWatched: number}> = [];
        for (const [windowId, projectPath] of this.projectPaths.entries()) {
            const dirWatchers = this.watchers.get(windowId);
            stats.push({ 
                windowId, 
                projectPath,
                directoriesWatched: dirWatchers?.size || 0
            });
        }
        return {
            type: 'SimpleProjectWatcher (fs.watch)',
            activeProjects: this.watchers.size,
            projects: stats
        };
    }
}

export const simpleProjectWatcher = new SimpleProjectWatcher();
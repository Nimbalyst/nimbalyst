import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import chokidar, { FSWatcher } from 'chokidar';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getWindowId } from '../window/WindowManager';

/**
 * Whether the platform supports `fs.watch(dir, { recursive: true })`.
 *
 * macOS uses FSEvents (1 FD for the entire tree).
 * Windows uses ReadDirectoryChangesW (1 handle for the entire tree).
 * Linux does NOT support recursive: true and throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM.
 */
const supportsRecursiveWatch = process.platform === 'darwin' || process.platform === 'win32';

/**
 * Directories that should never trigger events.
 * Checked against every segment of the relative path.
 */
const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.nuxt',
    '.vscode',
    '.idea',
    'target',
    'worktrees',
    '.cache',
    '.turbo',
    '.svelte-kit',
]);

/**
 * Top-level directory names (relative to workspace root) that are
 * macOS system/protected dirs and should be ignored entirely.
 */
const IGNORED_TOP_DIRS = new Set([
    '.Trash', 'Library', 'Applications', 'Documents',
    'Downloads', 'Music', 'Pictures', 'Movies', 'Public',
    '.Spotlight-V100', '.TemporaryItems', '.fseventsd',
]);

/**
 * OS junk files that should be silently ignored.
 */
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db']);

/**
 * Returns true if the given path (relative to the workspace root,
 * with a leading `/`) should be ignored.
 */
function shouldIgnore(relativePath: string): boolean {
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length === 0) return false;

    // Ignore macOS system/protected top-level directories
    if (IGNORED_TOP_DIRS.has(segments[0])) {
        return true;
    }

    // Ignore if any segment is an ignored directory
    for (const seg of segments) {
        if (IGNORED_DIRS.has(seg)) {
            return true;
        }
    }

    const basename = segments[segments.length - 1];

    // Ignore OS junk files
    if (IGNORED_BASENAMES.has(basename)) {
        return true;
    }

    // Ignore Unix socket files (e.g. .gnupg/S.gpg-agent)
    if (basename.startsWith('S.')) {
        return true;
    }

    return false;
}

/**
 * Optimized workspace watcher.
 *
 * On macOS and Windows: uses `fs.watch(dir, { recursive: true })` which
 * consumes a single file descriptor for the entire directory tree via
 * FSEvents / ReadDirectoryChangesW.
 *
 * On Linux: falls back to chokidar which uses per-file inotify watches
 * (recursive fs.watch is not supported on Linux).
 */
export class OptimizedWorkspaceWatcher {
    /** Native fs.FSWatcher for macOS/Windows, or chokidar FSWatcher for Linux */
    private watchers = new Map<number, fs.FSWatcher | FSWatcher>();
    private updateTimers = new Map<number, NodeJS.Timeout>();
    private workspacePaths = new Map<number, string>();
    private watchedPaths = new Map<number, Set<string>>();

    async start(window: BrowserWindow, workspacePath: string) {
        const windowId = getWindowId(window);
        if (windowId === null) {
            logger.workspaceWatcher.error('Failed to find window ID');
            return;
        }

        this.stop(windowId);

        this.workspacePaths.set(windowId, workspacePath);
        this.watchedPaths.set(windowId, new Set([workspacePath]));

        // Debounced update function — shared by both code paths
        const triggerUpdate = () => {
            const existingTimer = this.updateTimers.get(windowId);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                logger.workspaceWatcher.debug('Updating file tree');
                const fileTree = getFolderContents(workspacePath);

                if (!window || window.isDestroyed()) {
                    console.log(`[WorkspaceWatcher] Window destroyed, skipping file tree update`);
                    return;
                }

                window.webContents.send('workspace-file-tree-updated', { fileTree });
            }, 500);

            this.updateTimers.set(windowId, timer);
        };

        if (supportsRecursiveWatch) {
            this.startRecursiveWatch(window, windowId, workspacePath, triggerUpdate);
        } else {
            this.startChokidarWatch(window, windowId, workspacePath, triggerUpdate);
        }
    }

    // ---------------------------------------------------------------
    // macOS / Windows: single recursive fs.watch
    // ---------------------------------------------------------------

    private startRecursiveWatch(
        window: BrowserWindow,
        windowId: number,
        workspacePath: string,
        triggerUpdate: () => void
    ) {
        try {
            const watcher = fs.watch(workspacePath, { recursive: true }, (eventType: string, filename: string | null) => {
                if (!filename) return;

                // filename is relative to workspacePath (forward-slash on all platforms)
                const relativePath = '/' + filename.split(path.sep).join('/');

                if (shouldIgnore(relativePath)) return;

                const absolutePath = path.join(workspacePath, filename);

                if (eventType === 'change') {
                    // Content modification — notify editors, do NOT rebuild file tree
                    if (!window.isDestroyed()) {
                        window.webContents.send('file-changed-on-disk', { path: absolutePath });
                    }
                } else {
                    // 'rename' — could be add or delete.
                    // Either way the tree structure changed.
                    console.log(`[WorkspaceWatcher] rename event: ${absolutePath}`);
                    triggerUpdate();

                    // Also send file-changed-on-disk for renames so editors
                    // pick up external renames / deletions.
                    if (!window.isDestroyed()) {
                        window.webContents.send('file-changed-on-disk', { path: absolutePath });
                    }
                }
            });

            watcher.on('error', (error: NodeJS.ErrnoException) => {
                const code = error.code;
                if (code === 'EMFILE' || code === 'ENFILE') {
                    logger.workspaceWatcher.warn(
                        'Too many open files - some file tree changes may not be detected. Try closing other workspaces.'
                    );
                } else if (code === 'EPERM' || code === 'EACCES') {
                    logger.workspaceWatcher.debug(`Skipping unwatchable path: ${error}`);
                } else {
                    logger.workspaceWatcher.error('Watcher error:', error);
                    console.error(`[WorkspaceWatcher] Error:`, error);
                }
            });

            this.watchers.set(windowId, watcher);
        } catch (error) {
            logger.workspaceWatcher.error('Failed to start recursive workspace watcher:', error);
            console.error(`[WorkspaceWatcher] Failed to start:`, error);
        }
    }

    // ---------------------------------------------------------------
    // Linux fallback: chokidar (existing behaviour)
    // ---------------------------------------------------------------

    private startChokidarWatch(
        window: BrowserWindow,
        windowId: number,
        workspacePath: string,
        triggerUpdate: () => void
    ) {
        try {
            const watcher = chokidar.watch(workspacePath, {
                ignored: (filePath: string, _stats?: any) => {
                    const relativePath = filePath.replace(workspacePath, '');
                    return shouldIgnore(relativePath);
                },
                ignoreInitial: true,
                followSymlinks: false,
                depth: 1,
                usePolling: false,
                atomic: true,
                awaitWriteFinish: {
                    stabilityThreshold: 200,
                    pollInterval: 100,
                },
                alwaysStat: false,
                interval: 300,
                binaryInterval: 500,
            });

            watcher
                .on('add', (filePath: string) => {
                    console.log(`[WorkspaceWatcher] *** FILE ADDED EVENT ***: ${filePath}`);
                    triggerUpdate();
                })
                .on('change', (filePath: string) => {
                    if (!window.isDestroyed()) {
                        window.webContents.send('file-changed-on-disk', { path: filePath });
                    }
                })
                .on('unlink', (filePath: string) => {
                    console.log(`[WorkspaceWatcher] File deleted: ${filePath}`);
                    triggerUpdate();
                })
                .on('addDir', (filePath: string) => {
                    console.log(`[WorkspaceWatcher] Directory added: ${filePath}`);
                    triggerUpdate();
                })
                .on('unlinkDir', (filePath: string) => {
                    console.log(`[WorkspaceWatcher] Directory deleted: ${filePath}`);
                    triggerUpdate();
                })
                .on('error', (error: unknown) => {
                    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
                    if (code === 'EMFILE' || code === 'ENFILE') {
                        logger.workspaceWatcher.warn(
                            'Too many open files - some file tree changes may not be detected. Try closing other workspaces or collapsing large folders.'
                        );
                    } else if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
                        logger.workspaceWatcher.debug(`Skipping unwatchable path: ${error}`);
                    } else {
                        logger.workspaceWatcher.error('Watcher error:', error);
                        console.error(`[WorkspaceWatcher] Error:`, error);
                    }
                });

            this.watchers.set(windowId, watcher);
        } catch (error) {
            logger.workspaceWatcher.error('Failed to start workspace watcher:', error);
            console.error(`[WorkspaceWatcher] Failed to start:`, error);
        }
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
            console.log(`[WorkspaceWatcher] No watcher found for window ${windowId}`);
            return;
        }

        // Guard: only watch folders within the workspace
        if (workspacePath && !folderPath.startsWith(workspacePath + '/') && folderPath !== workspacePath) {
            console.log(`[WorkspaceWatcher] Rejecting folder outside workspace: ${folderPath}`);
            return;
        }

        if (watchedPaths.has(folderPath)) {
            return;
        }

        watchedPaths.add(folderPath);

        // On Linux, also add to chokidar
        if (!supportsRecursiveWatch) {
            const watcher = this.watchers.get(windowId);
            if (watcher && 'add' in watcher) {
                console.log(`[WorkspaceWatcher] Adding watch for folder: ${folderPath}`);
                (watcher as FSWatcher).add(folderPath);
            }
        }
    }

    /**
     * Remove a folder from watch (called when user collapses a folder in the UI).
     *
     * On macOS/Windows this only updates tracking state.
     * On Linux (chokidar) this also unwatches from chokidar.
     */
    removeWatchedFolder(windowId: number, folderPath: string) {
        const watchedPaths = this.watchedPaths.get(windowId);
        if (!watchedPaths || !watchedPaths.has(folderPath)) {
            return;
        }

        watchedPaths.delete(folderPath);

        // On Linux, also remove from chokidar
        if (!supportsRecursiveWatch) {
            const watcher = this.watchers.get(windowId);
            if (watcher && 'unwatch' in watcher) {
                console.log(`[WorkspaceWatcher] Removing watch for folder: ${folderPath}`);
                (watcher as FSWatcher).unwatch(folderPath);
            }
        }
    }

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------

    stop(windowId: number) {
        const watcher = this.watchers.get(windowId);
        if (watcher) {
            console.log(`[WorkspaceWatcher] Stopping watcher for window ${windowId}`);
            if ('close' in watcher && typeof watcher.close === 'function') {
                watcher.close();
            }
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
                if (supportsRecursiveWatch) {
                    // Native fs.FSWatcher — close() is synchronous
                    (watcher as fs.FSWatcher).close();
                } else {
                    // chokidar FSWatcher — close() returns a Promise
                    const chokidarWatcher = watcher as FSWatcher;
                    const watched = chokidarWatcher.getWatched();
                    const totalFiles = Object.values(watched).reduce(
                        (sum: number, files: string[]) => sum + files.length,
                        0
                    );
                    console.log(
                        `[CLEANUP] Watcher for window ${windowId} is watching ${totalFiles} files in ${Object.keys(watched).length} directories`
                    );
                    closePromises.push(chokidarWatcher.close());
                }
            } catch (error) {
                logger.workspaceWatcher.error(`Error closing watcher for window ${windowId}:`, error);
                console.error(`[CLEANUP] Error closing workspace watcher for window ${windowId}:`, error);
            }
        }

        if (closePromises.length > 0) {
            // Wait for chokidar watchers to close with a timeout
            const allClosesPromise = Promise.all(closePromises);
            const timeoutPromise = new Promise<void>((resolve) => {
                setTimeout(() => {
                    console.log(`[CLEANUP] Workspace watcher close timed out after 1000ms, forcing cleanup`);
                    resolve();
                }, 1000);
            });

            await Promise.race([allClosesPromise, timeoutPromise]);
        }

        this.watchers.clear();
        this.workspacePaths.clear();
        this.watchedPaths.clear();

        for (const timer of this.updateTimers.values()) {
            clearTimeout(timer);
        }
        this.updateTimers.clear();
        console.log(`[CLEANUP] OptimizedWorkspaceWatcher.stopAll complete`);
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
        return {
            type: supportsRecursiveWatch
                ? 'OptimizedWorkspaceWatcher (fs.watch recursive)'
                : 'OptimizedWorkspaceWatcher (chokidar)',
            activeWorkspaces: this.watchers.size,
            workspaces: stats,
        };
    }
}

export const optimizedWorkspaceWatcher = new OptimizedWorkspaceWatcher();

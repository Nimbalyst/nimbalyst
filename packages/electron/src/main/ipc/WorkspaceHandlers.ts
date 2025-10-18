import { ipcMain, BrowserWindow, app, shell } from 'electron';
import { readFileSync, readdirSync, statSync, existsSync, promises as fsPromises } from 'fs';
import * as fs from 'fs';
import { join, basename, dirname, extname } from 'path';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const { writeFile, mkdir, rename, unlink, rmdir, copyFile, readFile, rm, stat, cp } = fsPromises;

const execAsync = promisify(exec);
import { windowStates, getWindowId, createWindow } from '../window/WindowManager';
import { createSessionManagerWindow } from '../window/SessionManagerWindow';
import { createAgenticCodingWindow, getAgenticCodingWindow } from '../window/AgenticCodingWindow';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { getFolderContents } from '../utils/FileTree';
import { FIND_PRUNE_ARGS, RIPGREP_EXCLUDE_ARGS } from '../utils/fileFilters';
import {
    getWorkspaceRecentFiles,
    addWorkspaceRecentFile,
    store,
    getWorkspaceState,
    updateWorkspaceState
} from '../utils/store';
import { loadFileIntoWindow } from '../file/FileOperations';

// Cache for quick open file searches
const fileNameCaches = new Map<string, Array<{ path: string; name: string }>>();

export function registerWorkspaceHandlers() {
    // Get folder contents
    ipcMain.handle('get-folder-contents', (event, dirPath: string) => {
        return getFolderContents(dirPath);
    });

    // Create new file
    ipcMain.handle('create-file', async (event, filePath: string, content: string = '') => {
        try {
            await writeFile(filePath, content, 'utf-8');
            return { success: true, filePath };
        } catch (error: any) {
            console.error('Error creating file:', error);
            return { success: false, error: error.message };
        }
    });

    // Create new folder
    ipcMain.handle('create-folder', async (event, folderPath: string) => {
        try {
            await mkdir(folderPath, { recursive: true });
            return { success: true, folderPath };
        } catch (error: any) {
            console.error('Error creating folder:', error);
            return { success: false, error: error.message };
        }
    });

    // Read file content (without changing watcher or state)
    ipcMain.handle('read-file-content', async (event, filePath: string) => {
        // Skip virtual files - they don't exist on disk
        if (filePath.startsWith('virtual://')) {
            return null;
        }

        if (!existsSync(filePath)) {
            console.log('[READ_FILE] File does not exist:', filePath);
            return null;
        }

        try {
            const content = readFileSync(filePath, 'utf-8');
            return { content };
        } catch (error: any) {
            console.error('[READ_FILE] Failed to read file:', filePath, error);
            return null;
        }
    });

    // Switch workspace file
    ipcMain.handle('switch-workspace-file', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[SWITCH_FILE] ✗ No window found for event sender');
            return null;
        }

        // Skip virtual files - they don't exist on disk
        if (filePath.startsWith('virtual://')) {
            return null;
        }

        console.log('[SWITCH_FILE] Switching to file:', filePath);
        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[SWITCH_FILE] Failed to find custom window ID');
            return null;
        }

        try {
            const content = readFileSync(filePath, 'utf-8');
            // console.log('[SWITCH_FILE] File read successfully, length:', content.length);

            let state = windowStates.get(windowId);
            // console.log('[SWITCH_FILE] Window state exists:', !!state);

            // Create state if it doesn't exist
            if (!state) {
                // console.log('[SWITCH_FILE] Creating new window state for window:', windowId);
                state = {
                    mode: 'workspace',
                    filePath: null,
                    documentEdited: false,
                    workspacePath: null
                };
                windowStates.set(windowId, state);
            }

            const oldFilePath = state.filePath;
            // console.log('[SWITCH_FILE] Previous file:', oldFilePath);

            // Note: We no longer stop the old file watcher here.
            // SimpleFileWatcher now supports watching multiple files per window,
            // so all open tabs can be watched simultaneously.

            // Update state
            state.filePath = filePath;
            state.documentEdited = false;
            // console.log('[SWITCH_FILE] Updated window state with new file path');

            // Add to recent workspace files
            if (state.workspacePath) {
                addWorkspaceRecentFile(state.workspacePath, filePath);
                // console.log('[SWITCH_FILE] Added to recent files');
            }

            // NOTE: File watching is now handled by start-watching-file/stop-watching-file
            // which are called when tabs are opened/closed, not when switching between them.
            // This ensures all open tabs remain watched even when in the background.

            // Set represented filename for macOS
            if (process.platform === 'darwin') {
                window.setRepresentedFilename(filePath);
                // console.log('[SWITCH_FILE] Updated macOS represented filename');
            }

            // console.log('[SWITCH_FILE] ✓ Switch complete, state:', {
            //     filePath: state.filePath,
            //     workspacePath: state.workspacePath,
            //     documentEdited: state.documentEdited
            // });

            return { filePath, content };
        } catch (error) {
            console.error('[SWITCH_FILE] ✗ Error switching workspace file:', error);
            return null;
        }
    });

    // Build file name cache for quick open
    ipcMain.handle('build-quick-open-cache', async (event, workspacePath: string) => {
        try {
            const escapedPath = workspacePath.replace(/["'\\]/g, '\\$&');
            // Use centralized prune arguments to exclude directories
            const findCommand = `find "${escapedPath}" ${FIND_PRUNE_ARGS} -type f \\( -name "*.md" -o -name "*.markdown" \\) -print 2>/dev/null`;
            const { stdout } = await execAsync(findCommand, { shell: '/bin/bash' });

            const cache: Array<{ path: string; name: string }> = [];
            if (stdout) {
                const files = stdout.split('\n').filter(f => f.trim());
                for (const file of files) {
                    cache.push({
                        path: file,
                        name: basename(file).toLowerCase()
                    });
                }
            }

            fileNameCaches.set(workspacePath, cache);
            return { success: true, fileCount: cache.length };
        } catch (error) {
            console.error('Error building quick open cache:', error);
            return { success: false, error: String(error) };
        }
    });

    // Search workspace file names only (fast, uses cache)
    ipcMain.handle('search-workspace-file-names', async (event, workspacePath: string, query: string) => {
        try {
            const trimmedQuery = query.trim().toLowerCase();
            if (!trimmedQuery) return [];

            // Use cache if available
            const cache = fileNameCaches.get(workspacePath);
            if (!cache) {
                console.warn('Quick open cache not built for workspace:', workspacePath);
                return [];
            }

            // Filter cache by name match
            const results = cache
                .filter(item => item.name.includes(trimmedQuery))
                .slice(0, 50)
                .map(item => ({
                    path: item.path,
                    isFileNameMatch: true,
                    matches: []
                }));

            return results;
        } catch (error) {
            console.error('Error searching file names:', error);
            return [];
        }
    });

    // Search workspace file content using ripgrep (slower)
    ipcMain.handle('search-workspace-file-content', async (event, workspacePath: string, query: string) => {
        try {
            const trimmedQuery = query.trim();
            if (!trimmedQuery) return [];

            // Escape special characters for shell
            const escapedTerm = trimmedQuery.replace(/["'\\]/g, '\\$&');

            // Try to use bundled ripgrep from claude-code, fall back to system rg
            let rgPath = 'rg';

            // Determine the platform-specific ripgrep binary
            const platform = os.platform();
            const arch = os.arch();
            let rgBinaryDir = '';

            if (platform === 'darwin') {
                rgBinaryDir = arch === 'arm64' ? 'arm64-darwin' : 'x64-darwin';
            } else if (platform === 'win32') {
                rgBinaryDir = 'x64-windows';
            } else if (platform === 'linux') {
                rgBinaryDir = arch === 'arm64' ? 'arm64-linux' : 'x64-linux';
            }

            const rgBinaryName = platform === 'win32' ? 'rg.exe' : 'rg';
            const isPackaged = app.isPackaged;

            // Use a variable to avoid Vite trying to resolve 'node_modules' as an identifier
            const NODE_MODULES_DIR = ['node', '_', 'modules'].join('');

            // Check all possible paths, both dev and production
            const possibleRgPaths = [];

            if (isPackaged) {
                const resourcesPath = process.resourcesPath;
                possibleRgPaths.push(
                    path.join(resourcesPath, 'app.asar.unpacked', NODE_MODULES_DIR, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                );
            } else {
                possibleRgPaths.push(
                    path.join(__dirname, '..', '..', NODE_MODULES_DIR, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    path.join(process.cwd(), NODE_MODULES_DIR, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                );
            }

            for (const testPath of possibleRgPaths) {
                if (existsSync(testPath)) {
                    rgPath = testPath;
                    if (isPackaged && platform !== 'win32') {
                        try {
                            fs.chmodSync(rgPath, 0o755);
                        } catch (e) {
                            console.warn('[SEARCH] Could not set executable permission on ripgrep:', e);
                        }
                    }
                    break;
                }
            }

            // Use centralized ripgrep exclude arguments
            const contentCommand = `"${rgPath}" --type md -i --json ${RIPGREP_EXCLUDE_ARGS} "${escapedTerm}" "${workspacePath}" 2>/dev/null || true`;
            const { stdout } = await execAsync(contentCommand, { maxBuffer: 5 * 1024 * 1024 });

            const contentMatches = new Map<string, any>();
            if (stdout) {
                const lines = stdout.split('\n').filter(line => line.trim());
                for (const line of lines) {
                    try {
                        const item = JSON.parse(line);
                        if (item.type === 'match') {
                            const filePath = item.data.path.text;
                            if (!contentMatches.has(filePath)) {
                                contentMatches.set(filePath, {
                                    path: filePath,
                                    isContentMatch: true,
                                    matches: []
                                });
                            }

                            contentMatches.get(filePath).matches.push({
                                line: item.data.line_number,
                                text: item.data.lines.text.trim(),
                                start: item.data.submatches[0]?.start || 0,
                                end: item.data.submatches[0]?.end || item.data.lines.text.length
                            });
                        }
                    } catch (e) {
                        // Skip invalid JSON lines
                    }
                }
            }

            return Array.from(contentMatches.values()).slice(0, 50);
        } catch (error) {
            console.error('Error searching file content:', error);
            return [];
        }
    });

    // Legacy handler that combines both (for backward compatibility)
    ipcMain.handle('search-workspace-files', async (event, workspacePath: string, query: string) => {
        try {
            const trimmedQuery = query.trim();
            if (!trimmedQuery) return [];

            // Escape special characters for shell
            const escapedTerm = trimmedQuery.replace(/["'\\]/g, '\\$&');

            // Search both file names and content using ripgrep
            // Use --files-with-matches to get file list, then search content
            const allResults = [];

            // First, search file names using centralized exclusion logic
            try {
                const fileNameCommand = `find "${workspacePath}" ${FIND_PRUNE_ARGS} \\( -name "*.md" -o -name "*.markdown" \\) -print 2>/dev/null | grep -i "${escapedTerm}" | head -50 || true`;
                const { stdout: fileMatches } = await execAsync(fileNameCommand);

                if (fileMatches) {
                    const files = fileMatches.split('\n').filter(f => f.trim());
                    for (const file of files) {
                        allResults.push({
                            path: file,
                            isFileNameMatch: true,
                            matches: []
                        });
                    }
                }
            } catch (e) {
                // Ignore file name search errors
            }

            // Then search content using ripgrep
            let contentCommand = ''; // Define at outer scope for error handling
            try {
                // Try to use bundled ripgrep from claude-code, fall back to system rg
                let rgPath = 'rg';
                const app = require('electron').app;
                const path = require('path'); // Ensure path is required locally
                const os = require('os');
                const fs = require('fs');

                // Determine the platform-specific ripgrep binary
                const platform = os.platform();
                const arch = os.arch();
                let rgBinaryDir = '';

                if (platform === 'darwin') {
                    rgBinaryDir = arch === 'arm64' ? 'arm64-darwin' : 'x64-darwin';
                } else if (platform === 'win32') {
                    rgBinaryDir = 'x64-windows';
                } else if (platform === 'linux') {
                    rgBinaryDir = arch === 'arm64' ? 'arm64-linux' : 'x64-linux';
                }

                const rgBinaryName = platform === 'win32' ? 'rg.exe' : 'rg';

                // In production, files are in app.asar.unpacked
                const isPackaged = app.isPackaged;

                // Use a variable to avoid Vite trying to resolve 'node_modules' as an identifier
                const NODE_MODULES_DIR = ['node', '_', 'modules'].join('');

                // Check all possible paths, both dev and production
                const possibleRgPaths = [];

                if (isPackaged) {
                    // Production paths - files are unpacked from ASAR
                    const resourcesPath = process.resourcesPath;
                    possibleRgPaths.push(
                        // Standard unpacked location
                        path.join(resourcesPath, 'app.asar.unpacked', NODE_MODULES_DIR, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    );
                } else {
                    // Development paths
                    possibleRgPaths.push(
                        path.join(__dirname, '..', '..', NODE_MODULES_DIR, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                        path.join(process.cwd(), NODE_MODULES_DIR, '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    );
                }

                // console.log('[SEARCH] Looking for ripgrep. isPackaged:', isPackaged, 'platform:', platform, 'arch:', arch);
                // console.log('[SEARCH] Binary dir:', rgBinaryDir, 'Binary name:', rgBinaryName);
                // console.log('[SEARCH] Checking paths:', possibleRgPaths);

                for (const testPath of possibleRgPaths) {
                    if (existsSync(testPath)) {
                        rgPath = testPath;
                        console.log('[SEARCH] Found ripgrep at:', rgPath);

                        // Make sure the binary is executable in production
                        if (isPackaged && platform !== 'win32') {
                            try {
                                fs.chmodSync(rgPath, 0o755);
                                console.log('[SEARCH] Set executable permission on ripgrep');
                            } catch (e) {
                                console.warn('[SEARCH] Could not set executable permission on ripgrep:', e);
                            }
                        }
                        break;
                    } else {
                        console.log('[SEARCH] Not found at:', testPath);
                    }
                }

                if (rgPath === 'rg') {
                    console.warn('[SEARCH] Could not find bundled ripgrep, falling back to system rg');
                }

                // Use centralized ripgrep exclude arguments
                contentCommand = `"${rgPath}" --type md -i --json ${RIPGREP_EXCLUDE_ARGS} "${escapedTerm}" "${workspacePath}" 2>/dev/null || true`;
                const { stdout } = await execAsync(contentCommand, { maxBuffer: 5 * 1024 * 1024 });

                if (stdout) {
                    const lines = stdout.split('\n').filter(line => line.trim());
                    const contentMatches = new Map<string, any>();

                    for (const line of lines) {
                        try {
                            const item = JSON.parse(line);
                            if (item.type === 'match') {
                                const filePath = item.data.path.text;
                                if (!contentMatches.has(filePath)) {
                                    contentMatches.set(filePath, {
                                        path: filePath,
                                        isContentMatch: true,
                                        matches: []
                                    });
                                }

                                // Add match with line number and text
                                contentMatches.get(filePath).matches.push({
                                    line: item.data.line_number,
                                    text: item.data.lines.text.trim(),
                                    start: item.data.submatches[0]?.start || 0,
                                    end: item.data.submatches[0]?.end || item.data.lines.text.length
                                });
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }

                    // Merge content matches with existing results
                    for (const [filePath, data] of contentMatches) {
                        const existing = allResults.find(r => r.path === filePath);
                        if (existing) {
                            // File matches both name and content
                            existing.matches = data.matches;
                            existing.isContentMatch = true;
                        } else {
                            allResults.push(data);
                        }
                    }
                }
            } catch (error: any) {
                console.error('Error executing ripgrep:', error);
                console.error('[SEARCH] Command was:', contentCommand);
                console.error('[SEARCH] Error details:', error.message, error.code);
                // Return empty results on error instead of throwing
            }

            // Sort by relevance: files matching both name and content first
            allResults.sort((a, b) => {
                const aScore = (a.isFileNameMatch ? 2 : 0) + (a.isContentMatch ? 1 : 0);
                const bScore = (b.isFileNameMatch ? 2 : 0) + (b.isContentMatch ? 1 : 0);
                return bScore - aScore;
            });

            return allResults.slice(0, 50);

        } catch (error) {
            console.error('Error searching workspace files:', error);
            return [];
        }
    });

    // Get recent workspace files
    ipcMain.handle('get-recent-workspace-files', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return [];

        const windowId = getWindowId(window);
        if (windowId === null) return [];

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) return [];

        // Get recent files for this workspace from store
        const workspaceRecentFiles = getWorkspaceRecentFiles(state.workspacePath);

        // Ensure it's an array before filtering
        if (!Array.isArray(workspaceRecentFiles)) {
            console.error('[WorkspaceHandlers] workspaceRecentFiles is not an array:', workspaceRecentFiles);
            return [];
        }

        // Filter to only existing files
        return workspaceRecentFiles.filter(filePath => existsSync(filePath)).slice(0, 20);
    });

    // Add to workspace recent files
    ipcMain.on('add-to-workspace-recent-files', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        const windowId = getWindowId(window);
        if (windowId === null) return;

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) return;

        addWorkspaceRecentFile(state.workspacePath, filePath);
    });

    // Get entire workspace state - no routing, no BS
    ipcMain.handle('workspace:get-state', async (event, workspacePath: string) => {
        return getWorkspaceState(workspacePath);
    });

    // Update workspace state - takes partial update, merges atomically
    ipcMain.handle('workspace:update-state', async (event, workspacePath: string, updates: any) => {
        return updateWorkspaceState(workspacePath, (state) => {
            Object.assign(state, updates);
        });
    });

    // File operations for workspace files
    ipcMain.handle('rename-file', async (event, oldPath: string, newName: string) => {

        try {
            const newPath = join(dirname(oldPath), newName);

            // Stop watching before rename to prevent false delete detection
            for (const [windowId, state] of windowStates) {
                if (state?.filePath === oldPath) {
                    console.log('[RENAME] Stopping file watcher before rename for:', oldPath);
                    stopFileWatcher(windowId);
                }
            }

            await rename(oldPath, newPath);

            // Update windows that have this file open
            for (const [windowId, state] of windowStates) {
                if (state?.filePath === oldPath) {
                    state.filePath = newPath;
                    // Update represented filename for macOS
                    const window = BrowserWindow.getAllWindows().find(w => w.id === windowId);
                    if (window) {
                        if (process.platform === 'darwin') {
                            window.setRepresentedFilename(newPath);
                        }
                        // Start watching the renamed file
                        console.log('[RENAME] Starting file watcher after rename for:', newPath);
                        startFileWatcher(window, newPath);
                    }
                }
            }

            // Notify all windows about the file rename
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-renamed', { oldPath, newPath });
            });

            return { success: true, newPath };
        } catch (error: any) {
            console.error('Error renaming file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-file', async (event, filePath: string) => {

        try {
            const stats = await stat(filePath);

            if (stats.isDirectory()) {
                // For directories, use recursive removal
                await rm(filePath, { recursive: true, force: true });
            } else {
                await unlink(filePath);
            }

            // Clear file path for windows that have this file open
            for (const [windowId, state] of windowStates) {
                if (state?.filePath === filePath) {
                    state.filePath = null;
                    state.documentEdited = false;
                }
            }

            // Notify all windows about the file deletion
            console.log('[MAIN] Sending file-deleted event for:', filePath);
            const windows = BrowserWindow.getAllWindows();
            console.log('[MAIN] Number of windows to notify:', windows.length);
            windows.forEach((window, index) => {
                console.log(`[MAIN] Sending file-deleted to window ${index}`);
                window.webContents.send('file-deleted', { filePath });
            });

            return { success: true };
        } catch (error: any) {
            console.error('Error deleting file:', error);
            return { success: false, error: error.message };
        }
    });

    // Move file/folder
    ipcMain.handle('move-file', async (event, sourcePath: string, targetPath: string) => {

        try {
            // Check if source exists
            const sourceStats = await stat(sourcePath);

            // Check if target is a directory
            let destinationPath = targetPath;
            try {
                const targetStats = await stat(targetPath);
                if (targetStats.isDirectory()) {
                    // If target is a directory, move source into it
                    destinationPath = join(targetPath, basename(sourcePath));
                }
            } catch {
                // Target doesn't exist, use it as the new path
            }

            // Update windows that have this file open - BEFORE the move
            // This prevents the file watcher from detecting an unlink event
            if (!sourceStats.isDirectory()) {
                for (const [windowId, state] of windowStates) {
                    if (state?.filePath === sourcePath) {
                        // Stop watching the old file BEFORE moving
                        console.log('[MOVE] Stopping file watcher before move for:', sourcePath);
                        stopFileWatcher(windowId);
                    }
                }
            }

            // Perform the move
            await rename(sourcePath, destinationPath);

            // Update windows that have this file open - AFTER the move
            if (!sourceStats.isDirectory()) {
                for (const [windowId, state] of windowStates) {
                    if (state?.filePath === sourcePath) {
                        // Update the file path
                        state.filePath = destinationPath;

                        // Update represented filename for macOS
                        const window = BrowserWindow.getAllWindows().find(w => w.id === windowId);
                        if (window) {
                            if (process.platform === 'darwin') {
                                window.setRepresentedFilename(destinationPath);
                            }
                            // Start watching the new file
                            console.log('[MOVE] Starting file watcher after move for:', destinationPath);
                            startFileWatcher(window, destinationPath);
                        }
                    }
                }
            }

            // Notify all windows about the file move
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-moved', { sourcePath, destinationPath });
            });

            return { success: true, newPath: destinationPath };
        } catch (error: any) {
            console.error('Error moving file:', error);
            return { success: false, error: error.message };
        }
    });

    // Copy file/folder
    ipcMain.handle('copy-file', async (event, sourcePath: string, targetPath: string) => {

        try {
            // Check if source exists
            const sourceStats = await stat(sourcePath);

            // Check if target is a directory
            let destinationPath = targetPath;
            try {
                const targetStats = await stat(targetPath);
                if (targetStats.isDirectory()) {
                    // If target is a directory, copy source into it
                    let destName = basename(sourcePath);
                    destinationPath = join(targetPath, destName);

                    // Check if file already exists and generate unique name
                    let counter = 1;
                    const nameWithoutExt = basename(sourcePath, extname(sourcePath));
                    const ext = extname(sourcePath);

                    while (existsSync(destinationPath)) {
                        destName = `${nameWithoutExt} copy${counter > 1 ? ' ' + counter : ''}${ext}`;
                        destinationPath = join(targetPath, destName);
                        counter++;
                    }
                }
            } catch {
                // Target doesn't exist, use it as the new path
            }

            // Perform the copy
            await cp(sourcePath, destinationPath, { recursive: true });

            // Notify all windows about the file copy
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('file-copied', { sourcePath, destinationPath });
            });

            return { success: true, newPath: destinationPath };
        } catch (error: any) {
            console.error('Error copying file:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('workspace:open-file', async (event, options: { workspacePath: string; filePath: string }) => {
        try {
            const { workspacePath, filePath } = options;

            // Find the workspace window for this workspace path
            let targetWindow: BrowserWindow | null = null;
            for (const [windowId, state] of windowStates) {
                if (state?.workspacePath === workspacePath && state.mode === 'workspace') {
                    const window = BrowserWindow.getAllWindows().find(w => getWindowId(w) === windowId);
                    if (window && !window.isDestroyed()) {
                        targetWindow = window;
                        break;
                    }
                }
            }

            // If no workspace window found, create a new one
            if (!targetWindow) {
                targetWindow = createWindow(true, false);
                await new Promise<void>(resolve => {
                    targetWindow!.once('ready-to-show', () => {
                        const windowId = getWindowId(targetWindow!);
                        if (windowId !== null) {
                            const state = windowStates.get(windowId);
                            if (state) {
                                state.workspacePath = workspacePath;
                            }
                        }
                        resolve();
                    });
                });
            }

            // Focus the window and load the file
            targetWindow.focus();
            await loadFileIntoWindow(targetWindow, filePath);

            return { success: true };
        } catch (error: any) {
            console.error('Error opening file in workspace:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-file-in-new-window', async (event, filePath: string) => {
        try {
            const newWindow = createWindow(true, false);
            newWindow.once('ready-to-show', () => {
                loadFileIntoWindow(newWindow, filePath);
            });
            return { success: true };
        } catch (error: any) {
            console.error('Error opening file in new window:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-session-manager', async (event, filterWorkspace?: string) => {
        try {
            createSessionManagerWindow(filterWorkspace);
            return { success: true };
        } catch (error: any) {
            console.error('Error opening session manager:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-agentic-coding-window', async (event, options: { workspacePath: string; sessionId?: string; planDocumentPath?: string }) => {
        try {
            createAgenticCodingWindow(options);
            return { success: true };
        } catch (error: any) {
            console.error('Error opening agentic coding window:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('show-in-finder', async (event, filePath: string) => {

        try {
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (error: any) {
            console.error('Error showing in finder:', error);
            return { success: false, error: error.message };
        }
    });

    // Plan Status Agent Session Integration
    ipcMain.handle('plan-status:launch-agent-session', async (event, options: { workspacePath: string; planDocumentPath: string }) => {
        try {
            const { workspacePath, planDocumentPath } = options;

            // Check if there's already an agentic coding window for this workspace
            const existingWindow = getAgenticCodingWindow(workspacePath);
            if (existingWindow && !existingWindow.isDestroyed()) {
                // Focus the existing window and create a new session tab
                existingWindow.focus();
                // The window will handle creating a new session
                return { success: true, sessionId: null };
            }

            // Create a new agentic coding window with the plan document attached
            const window = createAgenticCodingWindow({
                workspacePath,
                planDocumentPath
            });

            // The window will create its own session, but we need to return a session ID
            // For now, return success and let the window manage the session
            return { success: true, sessionId: null };
        } catch (error: any) {
            console.error('[PlanStatus] Error launching agent session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('plan-status:open-agent-session', async (event, options: { sessionId: string; workspacePath: string; planDocumentPath?: string }) => {
        try {
            const { sessionId, workspacePath, planDocumentPath } = options;

            // Check if there's already an agentic coding window for this workspace
            const existingWindow = getAgenticCodingWindow(workspacePath);
            if (existingWindow && !existingWindow.isDestroyed()) {
                // Focus the window and tell it to open the session
                existingWindow.focus();
                existingWindow.webContents.send('agentic-coding:open-session', sessionId);
                return { success: true };
            }

            // Create a new window with the session
            createAgenticCodingWindow({
                sessionId,
                workspacePath,
                planDocumentPath
            });

            return { success: true };
        } catch (error: any) {
            console.error('[PlanStatus] Error opening agent session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('plan-status:notify-session-created', async (event, options: { sessionId: string; planDocumentPath: string }) => {
        try {
            const { sessionId, planDocumentPath } = options;

            // Notify all workspace windows about the new session
            BrowserWindow.getAllWindows().forEach(window => {
                if (!window.isDestroyed()) {
                    window.webContents.send('plan-status:agent-session-created', sessionId, planDocumentPath);
                }
            });

            return { success: true };
        } catch (error: any) {
            console.error('[PlanStatus] Error notifying session created:', error);
            return { success: false, error: error.message };
        }
    });

    // Agentic coding state has been moved to unified workspace state
    // Use workspace:get-state and workspace:update-state instead
}

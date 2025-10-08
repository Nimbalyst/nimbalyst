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
import { createAgenticCodingWindow } from '../window/AgenticCodingWindow';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { getFolderContents } from '../utils/FileTree';
import {
    getWorkspaceRecentFiles,
    addWorkspaceRecentFile,
    store,
    getWorkspaceTabState,
    saveWorkspaceTabState,
    clearWorkspaceTabState
} from '../utils/store';
import { loadFileIntoWindow } from '../file/FileOperations';

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

    // Search workspace file names only (fast)
    ipcMain.handle('search-workspace-file-names', async (event, workspacePath: string, query: string) => {
        try {
            const trimmedQuery = query.trim().toLowerCase();
            if (!trimmedQuery) return [];

            // Escape special characters for shell
            const escapedPath = workspacePath.replace(/["'\\]/g, '\\$&');

            // First find all markdown files, then filter by basename matching the query
            // Using awk to extract basename and match against query
            const fileNameCommand = `find "${escapedPath}" -path "*/node_modules/*" -prune -o -type f \\( -name "*.md" -o -name "*.markdown" \\) -print 2>/dev/null | while read -r file; do basename="\$(basename "\$file")"; if echo "\$basename" | grep -qi "${trimmedQuery.replace(/["'\\]/g, '\\$&')}"; then echo "\$file"; fi; done | head -50`;
            const { stdout: fileMatches } = await execAsync(fileNameCommand, { shell: '/bin/bash' });

            const results = [];
            if (fileMatches) {
                const files = fileMatches.split('\n').filter(f => f.trim());
                for (const file of files) {
                    results.push({
                        path: file,
                        isFileNameMatch: true,
                        matches: []
                    });
                }
            }
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

            // Check all possible paths, both dev and production
            const possibleRgPaths = [];

            if (isPackaged) {
                const resourcesPath = process.resourcesPath;
                possibleRgPaths.push(
                    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                );
            } else {
                possibleRgPaths.push(
                    path.join(__dirname, '..', '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
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

            // Avoid scanning node_modules to keep quick open results relevant
            const contentCommand = `"${rgPath}" --type md -i --json --glob "!**/node_modules/**" "${escapedTerm}" "${workspacePath}" 2>/dev/null || true`;
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

            // First, search file names
            try {
                const fileNameCommand = `find "${workspacePath}" -path "*/node_modules/*" -prune -o \( -name "*.md" -o -name "*.markdown" \) -print 2>/dev/null | grep -i "${escapedTerm}" | head -50 || true`;
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

                // Check all possible paths, both dev and production
                const possibleRgPaths = [];

                if (isPackaged) {
                    // Production paths - files are unpacked from ASAR
                    const resourcesPath = process.resourcesPath;
                    possibleRgPaths.push(
                        // Standard unpacked location
                        path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    );
                } else {
                    // Development paths
                    possibleRgPaths.push(
                        path.join(__dirname, '..', '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                        path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
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

                // Avoid scanning node_modules to keep quick open results relevant
                contentCommand = `"${rgPath}" --type md -i --json --glob "!**/node_modules/**" "${escapedTerm}" "${workspacePath}" 2>/dev/null || true`;
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
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return [];

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
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) return;

        addWorkspaceRecentFile(state.workspacePath, filePath);
    });

    // Get workspace tab state
    ipcMain.handle('get-workspace-tab-state', async (event) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return null;

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) return null;

        // Use different storage for agentic coding windows
        const storageKey = state.mode === 'agentic-coding'
            ? `${state.workspacePath}:agentic-coding`
            : state.workspacePath;

        return getWorkspaceTabState(storageKey);
    });

    // Save workspace tab state
    ipcMain.on('save-workspace-tab-state', async (event, tabState) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) return;

        // Use different storage for agentic coding windows
        const storageKey = state.mode === 'agentic-coding'
            ? `${state.workspacePath}:agentic-coding`
            : state.workspacePath;

        saveWorkspaceTabState(storageKey, tabState);
    });

    // Clear workspace tab state
    ipcMain.on('clear-workspace-tab-state', (event) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) return;

        // Use different storage for agentic coding windows
        const storageKey = state.mode === 'agentic-coding'
            ? `${state.workspacePath}:agentic-coding`
            : state.workspacePath;

        clearWorkspaceTabState(storageKey);
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
}

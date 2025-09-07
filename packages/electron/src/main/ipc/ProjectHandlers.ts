import { ipcMain, BrowserWindow } from 'electron';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import { windowStates, getWindowId } from '../window/WindowManager';
import { createSessionManagerWindow } from '../window/SessionManagerWindow';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { getFolderContents } from '../utils/FileTree';
import { getProjectRecentFiles, addProjectRecentFile, store, getProjectTabState, saveProjectTabState, clearProjectTabState } from '../utils/store';

export function registerProjectHandlers() {
    // Get folder contents
    ipcMain.handle('get-folder-contents', (event, dirPath: string) => {
        return getFolderContents(dirPath);
    });

    // Create new file
    ipcMain.handle('create-file', async (event, filePath: string, content: string = '') => {
        const { writeFile } = require('fs').promises;
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
        const { mkdir } = require('fs').promises;
        try {
            await mkdir(folderPath, { recursive: true });
            return { success: true, folderPath };
        } catch (error: any) {
            console.error('Error creating folder:', error);
            return { success: false, error: error.message };
        }
    });

    // Switch project file
    ipcMain.handle('switch-project-file', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[SWITCH_FILE] ✗ No window found for event sender');
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
            console.log('[SWITCH_FILE] File read successfully, length:', content.length);
            
            let state = windowStates.get(windowId);
            console.log('[SWITCH_FILE] Window state exists:', !!state);
            
            // Create state if it doesn't exist
            if (!state) {
                console.log('[SWITCH_FILE] Creating new window state for window:', windowId);
                state = {
                    filePath: null,
                    documentEdited: false,
                    projectPath: null
                };
                windowStates.set(windowId, state);
            }

            const oldFilePath = state.filePath;
            console.log('[SWITCH_FILE] Previous file:', oldFilePath);
            
            // Stop watching the old file
            if (oldFilePath && oldFilePath !== filePath) {
                console.log('[SWITCH_FILE] Stopping watcher for old file');
                stopFileWatcher(windowId);
            }

            // Update state
            state.filePath = filePath;
            state.documentEdited = false;
            console.log('[SWITCH_FILE] Updated window state with new file path');
            
            // Add to recent project files
            if (state.projectPath) {
                addProjectRecentFile(state.projectPath, filePath);
                console.log('[SWITCH_FILE] Added to recent files');
            }

            // Start watching the new file
            startFileWatcher(window, filePath);
            console.log('[SWITCH_FILE] Started file watcher');

            // Set represented filename for macOS
            if (process.platform === 'darwin') {
                window.setRepresentedFilename(filePath);
                console.log('[SWITCH_FILE] Updated macOS represented filename');
            }

            console.log('[SWITCH_FILE] ✓ Switch complete, state:', {
                filePath: state.filePath,
                projectPath: state.projectPath,
                documentEdited: state.documentEdited
            });

            return { filePath, content };
        } catch (error) {
            console.error('[SWITCH_FILE] ✗ Error switching project file:', error);
            return null;
        }
    });

    // Search project files and content using ripgrep
    ipcMain.handle('search-project-files', async (event, projectPath: string, query: string) => {
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
                const fileNameCommand = `find "${projectPath}" -name "*.md" -o -name "*.markdown" 2>/dev/null | grep -i "${escapedTerm}" | head -50 || true`;
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
                        path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-code', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    );
                } else {
                    // Development paths
                    possibleRgPaths.push(
                        path.join(__dirname, '..', '..', 'node_modules', '@anthropic-ai', 'claude-code', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                        path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-code', 'vendor', 'ripgrep', rgBinaryDir, rgBinaryName),
                    );
                }
                
                console.log('[SEARCH] Looking for ripgrep. isPackaged:', isPackaged, 'platform:', platform, 'arch:', arch);
                console.log('[SEARCH] Binary dir:', rgBinaryDir, 'Binary name:', rgBinaryName);
                console.log('[SEARCH] Checking paths:', possibleRgPaths);
                
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
                
                contentCommand = `"${rgPath}" --type md -i --json "${escapedTerm}" "${projectPath}" 2>/dev/null || true`;
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
            console.error('Error searching project files:', error);
            return [];
        }
    });

    // Get recent project files
    ipcMain.handle('get-recent-project-files', (event) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return [];
        
        const state = windowStates.get(windowId);
        if (!state || !state.projectPath) return [];
        
        // Get recent files for this project from store
        const projectRecentFiles = getProjectRecentFiles(state.projectPath);
        
        // Filter to only existing files
        return projectRecentFiles.filter(filePath => existsSync(filePath)).slice(0, 20);
    });

    // Add to project recent files
    ipcMain.on('add-to-project-recent-files', (event, filePath: string) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;
        
        const state = windowStates.get(windowId);
        if (!state || !state.projectPath) return;
        
        addProjectRecentFile(state.projectPath, filePath);
    });

    // Get project tab state
    ipcMain.handle('get-project-tab-state', (event) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        console.log('[IPC] get-project-tab-state: windowId =', windowId);
        if (!windowId) {
            console.log('[IPC] No window ID');
            return null;
        }
        
        const state = windowStates.get(windowId);
        console.log('[IPC] Window state:', { mode: state?.mode, projectPath: state?.projectPath });
        if (!state || !state.projectPath) {
            console.log('[IPC] No state or project path');
            return null;
        }
        
        const tabState = getProjectTabState(state.projectPath);
        console.log('[IPC] Retrieved tab state:', tabState ? { numTabs: tabState.tabs?.length, hasActiveTab: !!tabState.activeTabId } : 'null');
        return tabState;
    });

    // Save project tab state
    ipcMain.on('save-project-tab-state', (event, tabState) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;
        
        const state = windowStates.get(windowId);
        if (!state || !state.projectPath) return;
        
        saveProjectTabState(state.projectPath, tabState);
    });

    // Clear project tab state
    ipcMain.on('clear-project-tab-state', (event) => {
        const windowId = BrowserWindow.fromWebContents(event.sender)?.id;
        if (!windowId) return;
        
        const state = windowStates.get(windowId);
        if (!state || !state.projectPath) return;
        
        clearProjectTabState(state.projectPath);
    });

    // File operations for project files
    ipcMain.handle('rename-file', async (event, oldPath: string, newName: string) => {
        const { rename } = require('fs').promises;
        const { dirname, join } = require('path');

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
        const { unlink, rm, stat } = require('fs').promises;

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
            BrowserWindow.getAllWindows().forEach(window => {
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
        const { rename, stat } = require('fs').promises;
        const { join, basename } = require('path');

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
        const { cp, stat } = require('fs').promises;
        const { join, basename, extname } = require('path');

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
            const { createWindow } = require('../window/WindowManager');
            const { loadFileIntoWindow } = require('../file/FileOperations');
            
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

    ipcMain.handle('open-session-manager', async (event, filterProject?: string) => {
        try {
            createSessionManagerWindow(filterProject);
            return { success: true };
        } catch (error: any) {
            console.error('Error opening session manager:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('show-in-finder', async (event, filePath: string) => {
        const { shell } = require('electron');

        try {
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (error: any) {
            console.error('Error showing in finder:', error);
            return { success: false, error: error.message };
        }
    });
}
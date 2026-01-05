import { ipcMain, BrowserWindow, app, shell } from 'electron';
import { readFileSync, readdirSync, statSync, existsSync, promises as fsPromises } from 'fs';
import * as fs from 'fs';
import { join, basename, dirname, extname } from 'path';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import * as chardet from 'chardet';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { openWorkspaceFile, openFile } from '../file/FileOpener';

const { writeFile, mkdir, rename, unlink, rmdir, copyFile, readFile, rm, stat, cp } = fsPromises;

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
import { windowStates, getWindowId, createWindow } from '../window/WindowManager';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { getFolderContents } from '../utils/FileTree';
import { RIPGREP_EXCLUDE_ARGS_ARRAY, QUICKOPEN_FILE_TYPE_ARGS } from '../utils/fileFilters';
import {
    getWorkspaceRecentFiles,
    addWorkspaceRecentFile,
    store,
    getWorkspaceState,
    updateWorkspaceState
} from '../utils/store';
import { loadFileIntoWindow } from '../file/FileOperations';

// Helper function to get file type from extension
function getFileType(filePath: string): string {
    const lowerPath = filePath.toLowerCase();
    // Check for compound extensions first
    if (lowerPath.endsWith('.mockup.html')) {
        return 'mockup';
    }
    const ext = extname(filePath).toLowerCase();
    const typeMap: Record<string, string> = {
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.txt': 'text',
    };
    return typeMap[ext] || 'other';
}

// Cache for quick open file searches
const fileNameCaches = new Map<string, Array<{ path: string; name: string }>>();

// Binary file extensions to exclude from QuickOpen results
// Note: Images are NOT excluded - Nimbalyst can display them
// Note: PDFs are NOT excluded - extensions may add support
const BINARY_EXTENSIONS = new Set([
    // Audio/Video
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flac', '.wav', '.ogg', '.webm', '.mkv',
    // Archives
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
    // Binaries/Libraries
    '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib', '.bin',
    // Documents (non-text)
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    // Database/Lock files
    '.db', '.sqlite', '.sqlite3', '.lock',
    // Fonts
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    // Other binary
    '.pyc', '.pyo', '.class', '.jar', '.war', '.ear',
    '.node', '.wasm',
]);

// Get the ripgrep binary path for the current platform
function getRipgrepPath(): string {
    const platform = os.platform();
    const arch = os.arch();
    let rgBinaryDir = '';

    if (platform === 'darwin') {
        rgBinaryDir = arch === 'arm64' ? 'arm64-darwin' : 'x64-darwin';
    } else if (platform === 'win32') {
        // Windows ARM can run x64 binaries via emulation, and there's no arm64-win32 binary
        rgBinaryDir = 'x64-win32';
    } else if (platform === 'linux') {
        rgBinaryDir = arch === 'arm64' ? 'arm64-linux' : 'x64-linux';
    }

    const rgBinaryName = platform === 'win32' ? 'rg.exe' : 'rg';
    const isPackaged = app.isPackaged;

    // Use a variable to avoid Vite trying to resolve 'node_modules' as an identifier
    const NODE_MODULES_DIR = ['node', '_', 'modules'].join('');

    const possibleRgPaths: string[] = [];

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
            // Make sure the binary is executable in production (non-Windows)
            if (isPackaged && platform !== 'win32') {
                try {
                    fs.chmodSync(testPath, 0o755);
                } catch (e) {
                    console.warn('[SEARCH] Could not set executable permission on ripgrep:', e);
                }
            }
            console.log('[SEARCH] Found ripgrep at:', testPath);
            return testPath;
        } else {
            console.log('[SEARCH] ripgrep not found at:', testPath);
        }
    }

    // Fall back to system rg
    console.warn('[SEARCH] Could not find bundled ripgrep, falling back to system rg');
    return 'rg';
}

// Cross-platform file finder using ripgrep --files
// Finds all files and filters out binary extensions
async function findWorkspaceFiles(dir: string): Promise<string[]> {
    const rgPath = getRipgrepPath();

    // Find ALL files, only exclude directories (no file type filtering)
    const rgArgs = [
        '--files',
        '--hidden',  // Include dotfiles like .gitignore
        ...RIPGREP_EXCLUDE_ARGS_ARRAY,
        dir
    ];

    let stdout = '';
    try {
        const result = await execFileAsync(rgPath, rgArgs, { maxBuffer: 5 * 1024 * 1024 });
        stdout = result.stdout;
    } catch (execError: any) {
        // ripgrep returns exit code 1 when no matches found
        if (execError.code === 1) {
            stdout = execError.stdout || '';
        } else {
            throw execError;
        }
    }

    if (!stdout) return [];

    return stdout
        .split('\n')
        .filter(line => line.trim())
        .map(file => path.normalize(file))
        .filter(file => {
            // Filter out binary files by extension
            const ext = path.extname(file).toLowerCase();
            return !BINARY_EXTENSIONS.has(ext);
        });
}

export function registerWorkspaceHandlers() {
    const analytics = AnalyticsService.getInstance();
    // Get folder contents
    ipcMain.handle('get-folder-contents', (event, dirPath: string) => {
        return getFolderContents(dirPath);
    });

    // Refresh folder contents (for when user expands a folder)
    ipcMain.handle('refresh-folder-contents', (event, folderPath: string) => {
        return getFolderContents(folderPath);
    });

    // Create new file
    ipcMain.handle('create-file', async (event, filePath: string, content: string = '') => {
        try {
            await writeFile(filePath, content, 'utf-8');

            // Track file creation from menu
            analytics.sendEvent('file_created', {
                creationType: 'new_file_menu',
                fileType: getFileType(filePath)
            });

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
    // Options:
    //   - encoding: 'utf-8' (default), 'latin1', 'ascii', etc., or 'binary' for base64, or 'auto' to auto-detect
    //   - binary: true to force binary/base64 reading (auto-detected by extension if not specified)
    ipcMain.handle('read-file-content', async (event, filePath: string, options?: { encoding?: BufferEncoding | 'binary' | 'auto'; binary?: boolean }) => {
        // Skip virtual files - they don't exist on disk
        if (filePath.startsWith('virtual://')) {
            return null;
        }

        if (!existsSync(filePath)) {
            // console.log('[READ_FILE] File does not exist:', filePath);
            return null;
        }

        try {
            const forceBinary = options?.binary || options?.encoding === 'binary';

            // Auto-detect binary files by extension if not explicitly specified
            let isBinary = forceBinary;
            if (!forceBinary) {
                const ext = extname(filePath).toLowerCase();
                const binaryExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.zip', '.tar', '.gz', '.woff', '.woff2', '.ttf', '.eot'];
                isBinary = binaryExtensions.includes(ext);
            }

            if (isBinary) {
                // Read binary files as base64
                const buffer = readFileSync(filePath);
                const content = buffer.toString('base64');
                return { success: true, content, isBinary: true };
            } else {
                // Read text files - auto-detect encoding or use specified encoding
                let encoding: BufferEncoding = 'utf-8';

                if (options?.encoding === 'auto' || !options?.encoding) {
                    // Auto-detect encoding for text files
                    const buffer = readFileSync(filePath);
                    const detected = chardet.detect(buffer);

                    if (detected) {
                        // Map detected encoding to Node.js encoding name
                        const encodingMap: Record<string, BufferEncoding> = {
                            'UTF-8': 'utf8',
                            'UTF-16LE': 'utf16le',
                            'UTF-16BE': 'utf16le', // Node doesn't have utf16be, use utf16le
                            'ISO-8859-1': 'latin1',
                            'windows-1252': 'latin1',
                            'Shift_JIS': 'utf8', // Fallback to utf8 for unsupported
                            'GB18030': 'utf8', // Fallback to utf8 for unsupported
                        };

                        encoding = encodingMap[detected] || 'utf8';
                    }
                } else if (options.encoding !== 'binary') {
                    encoding = options.encoding as BufferEncoding;
                }

                const content = readFileSync(filePath, encoding);
                return { success: true, content, isBinary: false, detectedEncoding: encoding };
            }
        } catch (error: any) {
            console.error('[READ_FILE] Failed to read file:', filePath, error);
            return { success: false, error: error.message };
        }
    });

    // Switch workspace file - uses unified FileOpener API
    ipcMain.handle('switch-workspace-file', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[SWITCH_FILE] No window found for event sender');
            return null;
        }

        // Skip virtual files - they don't exist on disk
        if (filePath.startsWith('virtual://')) {
            return null;
        }

        try {
            const windowId = getWindowId(window);
            const state = windowId !== null ? windowStates.get(windowId) : null;

            // Use unified FileOpener API with skipFileWatcher=true
            // File watchers are managed separately by start-watching-file/stop-watching-file
            // when tabs are opened/closed, not when switching between them
            const result = await openFile({
                filePath,
                workspacePath: state?.workspacePath || undefined,
                source: 'tab_switch',
                targetWindow: window,
                skipFileWatcher: true,  // Tabs manage their own watchers
                skipAnalytics: true      // Don't track tab switches as file opens
            });

            return {
                filePath: result.filePath,
                content: result.content
            };
        } catch (error) {
            console.error('[SWITCH_FILE] Error switching workspace file:', error);
            const errorMessage = error instanceof Error ? error.message : 'Failed to open file';
            return { error: errorMessage };
        }
    });

    // Build file name cache for quick open
    ipcMain.handle('build-quick-open-cache', async (event, workspacePath: string) => {
        try {
            // Use cross-platform Node.js file walking instead of Unix find command
            const files = await findWorkspaceFiles(workspacePath);

            const cache: Array<{ path: string; name: string }> = [];
            for (const file of files) {
                cache.push({
                    path: file,
                    name: basename(file).toLowerCase()
                });
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
                    // Normalize path separators to platform-native format
                    path: path.normalize(item.path),
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

            const rgPath = getRipgrepPath();
            const rgArgs = [
                ...QUICKOPEN_FILE_TYPE_ARGS,
                '-i',
                '--json',
                ...RIPGREP_EXCLUDE_ARGS_ARRAY,
                trimmedQuery,
                workspacePath
            ];

            let stdout = '';
            try {
                const result = await execFileAsync(rgPath, rgArgs, { maxBuffer: 5 * 1024 * 1024 });
                stdout = result.stdout;
            } catch (execError: any) {
                // ripgrep returns exit code 1 when no matches found, which is not an error
                if (execError.code === 1) {
                    stdout = execError.stdout || '';
                } else {
                    throw execError;
                }
            }

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
                                    path: path.normalize(filePath),
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

            const allResults: any[] = [];

            // First, search file names using ripgrep --files
            try {
                const allFiles = await findWorkspaceFiles(workspacePath);
                const queryLower = trimmedQuery.toLowerCase();
                const matchingFiles = allFiles
                    .filter(file => basename(file).toLowerCase().includes(queryLower))
                    .slice(0, 50);

                for (const file of matchingFiles) {
                    allResults.push({
                        path: file,
                        isFileNameMatch: true,
                        matches: []
                    });
                }
            } catch (e) {
                // Ignore file name search errors
            }

            // Then search content using ripgrep
            try {
                const rgPath = getRipgrepPath();
                const rgArgs = [
                    '--type', 'md',
                    '-i',
                    '--json',
                    ...RIPGREP_EXCLUDE_ARGS_ARRAY,
                    trimmedQuery,
                    workspacePath
                ];

                let stdout = '';
                try {
                    const result = await execFileAsync(rgPath, rgArgs, { maxBuffer: 5 * 1024 * 1024 });
                    stdout = result.stdout;
                } catch (execError: any) {
                    // ripgrep returns exit code 1 when no matches found, which is not an error
                    if (execError.code === 1) {
                        stdout = execError.stdout || '';
                    } else {
                        throw execError;
                    }
                }

                if (stdout) {
                    const lines = stdout.split('\n').filter(line => line.trim());
                    const contentMatches = new Map<string, any>();

                    for (const line of lines) {
                        try {
                            const item = JSON.parse(line);
                            if (item.type === 'match') {
                                const filePath = path.normalize(item.data.path.text);
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

                    // Merge content matches with existing results
                    for (const [filePath, data] of contentMatches) {
                        const existing = allResults.find(r => r.path === filePath);
                        if (existing) {
                            existing.matches = data.matches;
                            existing.isContentMatch = true;
                        } else {
                            allResults.push(data);
                        }
                    }
                }
            } catch (error: any) {
                console.error('Error executing ripgrep:', error);
                console.error('[SEARCH] Error details:', error.message, error.code);
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

            // Track file rename
            analytics.sendEvent('file_renamed', {
                fileType: getFileType(newPath)
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
            const isDirectory = stats.isDirectory();

            if (isDirectory) {
                // For directories, use recursive removal
                await rm(filePath, { recursive: true, force: true });
            } else {
                await unlink(filePath);
            }

            // Track file deletion (only for files, not directories)
            if (!isDirectory) {
                analytics.sendEvent('file_deleted', {
                    fileType: getFileType(filePath),
                    source: 'workspace_tree'
                });
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
            const { filePath } = options;

            // Send open-document event to the renderer to trigger handleWorkspaceFileSelect
            // which handles tab creation via switchWorkspaceFile (returns file content)
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) {
                throw new Error('No window found for event sender');
            }
            window.webContents.send('open-document', { path: filePath });

            return { success: true };
        } catch (error: any) {
            console.error('Error opening file in workspace:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('open-in-default-app', async (event, filePath: string) => {
        try {
            // Open file in the OS default application
            const result = await shell.openPath(filePath);
            if (result) {
                // openPath returns an error string if it failed, empty string on success
                return { success: false, error: result };
            }
            return { success: true };
        } catch (error: any) {
            console.error('Error opening file in default app:', error);
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

            // If no workspace window found, use the current window
            if (!targetWindow) {
                targetWindow = BrowserWindow.fromWebContents(event.sender);
            }

            if (!targetWindow) {
                console.error('[PlanStatus] No window found to launch agent session');
                return { success: false, error: 'No window found' };
            }

            // Switch to agent mode in the project window
            targetWindow.focus();
            targetWindow.webContents.send('set-content-mode', 'agent');

            // Insert the plan file reference into the agent input
            if (planDocumentPath) {
                targetWindow.webContents.send('agent:insert-plan-reference', planDocumentPath);
            }

            return { success: true, sessionId: null };
        } catch (error: any) {
            console.error('[PlanStatus] Error launching agent session:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('plan-status:open-agent-session', async (event, options: { sessionId: string; workspacePath: string; planDocumentPath?: string }) => {
        try {
            const { sessionId, workspacePath, planDocumentPath } = options;

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

            // If no workspace window found, use the current window
            if (!targetWindow) {
                targetWindow = BrowserWindow.fromWebContents(event.sender);
            }

            if (!targetWindow) {
                console.error('[PlanStatus] No window found to open agent session');
                return { success: false, error: 'No window found' };
            }

            // Switch to agent mode in the project window
            targetWindow.focus();
            targetWindow.webContents.send('set-content-mode', 'agent');
            // TODO: Load the specific session ID once agent panel supports it
            // targetWindow.webContents.send('agent:load-session', sessionId);

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

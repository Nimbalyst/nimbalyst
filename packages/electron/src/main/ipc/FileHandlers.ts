import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join, dirname } from 'path';
 import { windowStates, savingWindows, findWindowByFilePath, createWindow, getWindowId, windows, documentServices } from '../window/WindowManager';
import { loadFileIntoWindow, saveFile } from '../file/FileOperations';
import { startFileWatcher, stopFileWatcher, chokidarFileWatcher } from '../file/FileWatcher';
import { AUTOSAVE_DELAY } from '../utils/constants';
import { addWorkspaceRecentFile } from '../utils/store';
import { logger } from '../utils/logger';
import { homedir } from 'os';

export function registerFileHandlers() {
    // Open file dialog
    ipcMain.handle('open-file', async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;

        const result = await dialog.showOpenDialog(window, {
            properties: ['openFile'],
            filters: [
                { name: 'Markdown Files', extensions: ['md', 'markdown'] },
                { name: 'Text Files', extensions: ['txt'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            const windowId = getWindowId(window);
            if (windowId === null) {
                console.error('[FileHandlers] Failed to find custom window ID');
                return null;
            }
            const state = windowStates.get(windowId);

            if (state) {
                state.filePath = filePath;
                state.documentEdited = false;
            }

            const content = readFileSync(filePath, 'utf-8');

            // Start watching the file
            startFileWatcher(window, filePath);

            return { filePath, content };
        }

        return null;
    });

    // Save file
    ipcMain.handle('save-file', async (event, content: string, specificFilePath: string, lastKnownContent?: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[SAVE] ✗ No window found for event sender');
            return null;
        }

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[FileHandlers] Failed to find custom window ID');
            return null;
        }
        const state = windowStates.get(windowId);
        // ALWAYS use the specificFilePath provided
        const filePath = specificFilePath;

        console.log('[SAVE] save-file handler called at', new Date().toISOString(), 'for path:', filePath);

        try {
            if (!filePath) {
                console.error('[SAVE] ✗ No file path in window state!');
                console.error('[SAVE] State details:', {
                    stateExists: !!state,
                    stateKeys: state ? Object.keys(state) : [],
                    windowStatesSize: windowStates.size
                });
                return null;
            }

            // Check for conflicts with external changes before saving
            if (lastKnownContent !== undefined && existsSync(filePath)) {
                try {
                    const currentDiskContent = readFileSync(filePath, 'utf-8');
                    if (currentDiskContent !== lastKnownContent) {
                        console.log('[SAVE] ⚠ Conflict detected - file changed on disk since last load');
                        return {
                            success: false,
                            conflict: true,
                            filePath,
                            diskContent: currentDiskContent
                        };
                    }
                } catch (readError) {
                    console.error('[SAVE] Failed to check for conflicts:', readError);
                    // Continue with save if we can't read the file
                }
            }

            // Mark that we're saving to prevent file watcher from reacting
            savingWindows.add(windowId);
            console.log('[SAVE] Marked window as saving:', windowId);

            console.log('[SAVE] Writing to file:', filePath);
            saveFile(filePath, content);

            if (state) {
                state.documentEdited = false; // Reset dirty state after save
            }

            // Refresh metadata and tracker items cache immediately after save if in workspace mode
            if (state?.workspacePath) {
                const documentService = documentServices.get(state.workspacePath);
                console.log('[SAVE] Workspace mode:', state.workspacePath, 'documentService exists:', !!documentService);
                if (documentService) {
                    // Add a small delay to ensure file is fully written before reading
                    setTimeout(async () => {
                        try {
                            await documentService.refreshFileMetadata(filePath);
                            // Also refresh tracker items for this file
                            const relativePath = filePath.startsWith(state.workspacePath)
                                ? filePath.substring(state.workspacePath.length + 1)
                                : filePath;
                            console.log('[SAVE] Updating tracker items for:', relativePath);
                            await (documentService as any).updateTrackerItemsCache(relativePath);
                            console.log('[SAVE] Tracker items update completed');
                        } catch (err) {
                            console.error('[SAVE] Failed to refresh metadata/tracker items:', err);
                        }
                    }, 50);
                }
            } else {
                console.log('[SAVE] Not in workspace mode, state:', state);
            }

            // Clear the saving flag after a delay to ensure the file watcher doesn't react
            setTimeout(() => {
                savingWindows.delete(windowId);
            }, AUTOSAVE_DELAY);

            return { success: true, filePath };
        } catch (error) {
            console.error('[SAVE] ✗ Error saving file:', error);
            savingWindows.delete(windowId); // Clean up on error
            return null;
        }
    });

    // Save file as
    ipcMain.handle('save-file-as', async (event, content: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[FileHandlers] Failed to find custom window ID');
            return null;
        }
        const state = windowStates.get(windowId);

        try {
            const result = await dialog.showSaveDialog(window, {
                filters: [
                    { name: 'Markdown Files', extensions: ['md'] },
                    { name: 'Text Files', extensions: ['txt'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                defaultPath: state?.filePath || 'untitled.md'
            });

            if (!result.canceled && result.filePath) {
                const filePath = result.filePath;

                // Mark that we're saving to prevent file watcher from reacting
                savingWindows.add(windowId);
                console.log('[SAVE_AS] Marked window as saving:', windowId);

                if (state) {
                    state.filePath = filePath;
                    state.documentEdited = false;
                }

                saveFile(filePath, content);

                // Clear the saving flag after a delay
                setTimeout(() => {
                    savingWindows.delete(windowId);
                    // console.log('[SAVE_AS] Cleared saving flag for window:', windowId);
                }, AUTOSAVE_DELAY);

                // Set represented filename for macOS
                if (process.platform === 'darwin') {
                    window.setRepresentedFilename(filePath);
                }

                return { success: true, filePath };
            }

            return null;
        } catch (error) {
            console.error('Error in save-file-as:', error);
            return null;
        }
    });

    // Show error dialog
    ipcMain.handle('show-error-dialog', async (event, title: string, message: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        dialog.showErrorBox(title, message);
    });

    // Update current file path from renderer (for drag-drop and file creation)
    ipcMain.handle('set-current-file', async (event, filePath: string | null) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[SET_FILE] ✗ No window found for event sender');
            return { success: false, error: 'No window found' };
        }

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[SET_FILE] Failed to find custom window ID');
            return { success: false, error: 'Window ID not found' };
        }
        let state = windowStates.get(windowId);

        // Create state if it doesn't exist (can happen with new windows)
        if (!state) {
            console.log('[SET_FILE] Creating new window state for window:', windowId);
            state = {
                mode: 'document',
                filePath: null,
                documentEdited: false,
                workspacePath: null
            };
            windowStates.set(windowId, state);
        }

        // Only proceed if the file path actually changed
        if (state.filePath === filePath) {
            // No change, skip everything
            return { success: true };
        }

        // console.log('[SET_FILE] set-current-file called at', new Date().toISOString());
        // console.log('[SET_FILE] Window ID:', windowId);
        // console.log('[SET_FILE] New file path:', filePath);
        // console.log('[SET_FILE] State exists:', !!state);

        const oldFilePath = state.filePath;
        // console.log('[SET_FILE] Previous file path:', oldFilePath);

        // Stop watching the old file
        if (oldFilePath && oldFilePath !== filePath) {
            console.log('[SET_FILE] Stopping watcher for old file:', oldFilePath);
            stopFileWatcher(windowId);
        }

        // Update the file path
        state.filePath = filePath;
        console.log('[SET_FILE] Updated state with new file path');

        // Start watching the new file
        if (filePath) {
            console.log('[SET_FILE] Starting watcher for new file:', filePath);
            startFileWatcher(window, filePath);

            // Update represented filename for macOS
            if (process.platform === 'darwin') {
                window.setRepresentedFilename(filePath);
                console.log('[SET_FILE] Updated macOS represented filename');
            }
        }

        console.log('[SET_FILE] ✓ File path update complete');
        console.log('[SET_FILE] Final state:', {
            filePath: state.filePath,
            workspacePath: state.workspacePath,
            documentEdited: state.documentEdited
        });

        return { success: true };
    });

    // Create document for AI tools
    ipcMain.handle('create-document', async (event, relativePath: string, initialContent: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[CREATE_DOC] No window found for event sender');
            return { success: false, error: 'No window found' };
        }

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[CREATE_DOC] Failed to find custom window ID');
            return { success: false, error: 'Window ID not found' };
        }

        const state = windowStates.get(windowId);
        if (!state || !state.workspacePath) {
            console.error('[CREATE_DOC] No workspace path in window state');
            return { success: false, error: 'No workspace open' };
        }

        try {
            // Build the absolute path
            const absolutePath = join(state.workspacePath, relativePath);
            const directory = dirname(absolutePath);

            console.log('[CREATE_DOC] Creating document:', absolutePath);

            // Ensure the directory exists
            if (!existsSync(directory)) {
                mkdirSync(directory, { recursive: true });
                console.log('[CREATE_DOC] Created directory:', directory);
            }

            // Check if file already exists
            if (existsSync(absolutePath)) {
                console.log('[CREATE_DOC] File already exists:', absolutePath);
                return {
                    success: false,
                    error: 'File already exists',
                    filePath: absolutePath
                };
            }

            // Write the initial content
            writeFileSync(absolutePath, initialContent || '', 'utf-8');
            console.log('[CREATE_DOC] File created successfully');

            // Add to recent files
            if (state.workspacePath) {
                addWorkspaceRecentFile(state.workspacePath, absolutePath);
            }

            return {
                success: true,
                filePath: absolutePath
            };
        } catch (error) {
            console.error('[CREATE_DOC] Error creating document:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // Write to global ~/.claude/ directory
    ipcMain.handle('write-global-claude-file', async (event, relativePath: string, content: string) => {
        try {
            const claudeDir = join(homedir(), '.claude');
            const absolutePath = join(claudeDir, relativePath);
            const directory = dirname(absolutePath);

            console.log('[WRITE_GLOBAL] Writing to global .claude:', absolutePath);

            // Ensure the directory exists
            if (!existsSync(directory)) {
                mkdirSync(directory, { recursive: true });
                console.log('[WRITE_GLOBAL] Created directory:', directory);
            }

            // Write the content (overwrites if exists)
            writeFileSync(absolutePath, content, 'utf-8');
            console.log('[WRITE_GLOBAL] File written successfully');

            return {
                success: true,
                filePath: absolutePath
            };
        } catch (error) {
            console.error('[WRITE_GLOBAL] Error writing file:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // Read from global ~/.claude/ directory
    ipcMain.handle('read-global-claude-file', async (event, relativePath: string) => {
        try {
            const claudeDir = join(homedir(), '.claude');
            const absolutePath = join(claudeDir, relativePath);

            console.log('[READ_GLOBAL] Reading from global .claude:', absolutePath);

            if (!existsSync(absolutePath)) {
                return {
                    success: false,
                    error: 'File not found'
                };
            }

            const content = readFileSync(absolutePath, 'utf-8');
            console.log('[READ_GLOBAL] File read successfully');

            return {
                success: true,
                content,
                filePath: absolutePath
            };
        } catch (error) {
            console.error('[READ_GLOBAL] Error reading file:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    });

    // Start watching a file (when tab is opened)
    ipcMain.handle('start-watching-file', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[START_WATCH] No window found');
            return { success: false };
        }

        if (!filePath || filePath.startsWith('virtual://')) {
            return { success: false };
        }

        try {
            // Wait for the watcher to be ready before returning
            await startFileWatcher(window, filePath);
            return { success: true };
        } catch (error) {
            logger.error('[START_WATCH] Failed to start watcher:', error);
            return { success: false, error: String(error) };
        }
    });

    // Stop watching a specific file (when tab is closed)
    ipcMain.handle('stop-watching-file', async (event, filePath: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            console.error('[STOP_WATCH] No window found');
            return { success: false };
        }

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[STOP_WATCH] Failed to find custom window ID');
            return { success: false };
        }

        if (!filePath || filePath.startsWith('virtual://')) {
            return { success: false };
        }

        console.log('[STOP_WATCH] Stopping file watcher for:', filePath);
        // Use the ChokidarFileWatcher's stopFile method to stop watching a specific file
        chokidarFileWatcher.stopFile(windowId, filePath);
        return { success: true };
    });
}

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
 import { windowStates, savingWindows, findWindowByFilePath, createWindow, getWindowId, windows } from '../window/WindowManager';
import { loadFileIntoWindow, saveFile } from '../file/FileOperations';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { AUTOSAVE_DELAY } from '../utils/constants';
import { addProjectRecentFile } from '../utils/store';
import { logger } from '../utils/logger';

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
    ipcMain.handle('save-file', async (event, content: string) => {
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
        const filePath = state?.filePath;

        console.log('[SAVE] save-file handler called at', new Date().toISOString());
        console.log('[SAVE] Window ID:', windowId);
        console.log('[SAVE] Window state exists:', !!state);
        console.log('[SAVE] Current state:', {
            hasState: !!state,
            filePath: state?.filePath,
            projectPath: state?.projectPath,
            documentEdited: state?.documentEdited
        });
        console.log('[SAVE] All window states:', Array.from(windowStates.entries()).map(([id, s]) => ({
            windowId: id,
            filePath: s?.filePath,
            projectPath: s?.projectPath
        })));

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

            // Mark that we're saving to prevent file watcher from reacting
            savingWindows.add(windowId);
            console.log('[SAVE] Marked window as saving:', windowId);

            console.log('[SAVE] Writing to file:', filePath);
            // console.log('[SAVE] Content preview (first 100 chars):', content.substring(0, 100));
            saveFile(filePath, content);

            if (state) {
                state.documentEdited = false; // Reset dirty state after save
                console.log('[SAVE] ✓ Reset documentEdited flag');
            }

            // Clear the saving flag after a delay to ensure the file watcher doesn't react
            setTimeout(() => {
                savingWindows.delete(windowId);
                console.log('[SAVE] Cleared saving flag for window:', windowId);
            }, AUTOSAVE_DELAY);

            console.log('[SAVE] ✓ Save successful to:', filePath);
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
                    console.log('[SAVE_AS] Cleared saving flag for window:', windowId);
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

        console.log('[SET_FILE] set-current-file called at', new Date().toISOString());
        console.log('[SET_FILE] Window ID:', windowId);
        console.log('[SET_FILE] New file path:', filePath);
        console.log('[SET_FILE] State exists:', !!state);

        // Create state if it doesn't exist (can happen with new windows)
        if (!state) {
            console.log('[SET_FILE] Creating new window state for window:', windowId);
            state = {
                filePath: null,
                documentEdited: false,
                projectPath: null
            };
            windowStates.set(windowId, state);
        }

        const oldFilePath = state.filePath;
        console.log('[SET_FILE] Previous file path:', oldFilePath);

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
            projectPath: state.projectPath,
            documentEdited: state.documentEdited
        });

        return { success: true };
    });
}

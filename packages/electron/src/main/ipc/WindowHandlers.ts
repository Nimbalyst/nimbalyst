import { ipcMain, BrowserWindow } from 'electron';
import { windowStates, windows, getWindowId } from '../window/WindowManager';
import { updateApplicationMenu } from '../menu/ApplicationMenu';
import { stopFileWatcher, startFileWatcher } from '../file/FileWatcher';
import { createAIModelsWindow } from '../window/AIModelsWindow';
import { basename } from 'path';
import { getFolderContents } from '../utils/FileTree';

export function registerWindowHandlers() {
    // Get initial window state
    ipcMain.handle('get-initial-state', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;
        
        const windowId = [...windows.entries()].find(([, win]) => win === window)?.[0];
        if (windowId === undefined) return null;
        
        const state = windowStates.get(windowId);
        if (!state) return null;
        
        // If it's a project mode window, return the full initial state
        if (state.mode === 'project' && state.projectPath) {
            const fileTree = getFolderContents(state.projectPath);
            return {
                mode: 'project',
                projectPath: state.projectPath,
                projectName: basename(state.projectPath),
                fileTree
            };
        }
        
        // For document mode, just return the mode
        return {
            mode: 'document'
        };
    });
    
    // Open AI Models window
    ipcMain.handle('window:open-ai-models', async () => {
        createAIModelsWindow();
    });
    // Set document edited state
    ipcMain.on('set-document-edited', (event, edited: boolean) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[SET_DOCUMENT_EDITED] Failed to find custom window ID');
            return;
        }
        const state = windowStates.get(windowId);
        if (state) {
            state.documentEdited = edited;
        }
        window.setDocumentEdited(edited);

        // Update menu to reflect new window state
        updateApplicationMenu();
    });

    // Set window title
    ipcMain.on('set-title', (event, title: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.setTitle(title);
            // Update menu to reflect new window title
            updateApplicationMenu();
        }
    });

    // Set current file path (for drag-drop)
    ipcMain.on('set-current-file', (event, filePath: string | null) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;

        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[SET_CURRENT_FILE] Failed to find custom window ID');
            return;
        }
        const state = windowStates.get(windowId);
        
        // Only proceed if the file path actually changed
        if (state?.filePath === filePath) {
            // No change, skip everything
            return;
        }
        
        console.log('[SET_FILE] Updating file path for window', windowId, 'from', state?.filePath, 'to', filePath);
        
        if (state) {
            // Stop watching the old file
            if (state.filePath && state.filePath !== filePath) {
                console.log('[SET_FILE] Stopping watcher for old file:', state.filePath);
                stopFileWatcher(windowId);
            }

            state.filePath = filePath;
            console.log('[SET_FILE] Window state after update:', { windowId, filePath: state.filePath });

            // Update menu to reflect new file
            updateApplicationMenu();

            // Start watching the new file
            if (filePath) {
                console.log('[SET_FILE] Starting watcher for new file:', filePath);
                startFileWatcher(window, filePath);
            }
        } else {
            console.log('[SET_FILE] WARNING: No window state found for window', windowId);
        }
        console.log('[SET_FILE] Current file path updated from renderer:', filePath);
    });
}
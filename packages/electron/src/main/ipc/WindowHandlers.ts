import { ipcMain, BrowserWindow, shell, nativeImage } from 'electron';
import { windowStates, windows, getWindowId } from '../window/WindowManager';
import { updateApplicationMenu } from '../menu/ApplicationMenu';
import { startFileWatcher } from '../file/FileWatcher';
import { createAIModelsWindow } from '../window/AIModelsWindow';
import { basename, join } from 'path';
import { getFolderContents } from '../utils/FileTree';
import { writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

export function registerWindowHandlers() {
    // Get initial window state
    ipcMain.handle('get-initial-state', (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;

        const windowId = [...windows.entries()].find(([, win]) => win === window)?.[0];
        if (windowId === undefined) return null;

        const state = windowStates.get(windowId);
        if (!state) return null;

        // If it's a workspace mode window, return the full initial state
        if (state.mode === 'workspace' && state.workspacePath) {
            const fileTree = getFolderContents(state.workspacePath);
            return {
                mode: 'workspace',
                workspacePath: state.workspacePath,
                workspaceName: basename(state.workspacePath),
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

    // Open external URL in default browser
    ipcMain.handle('open-external', async (event, url: string) => {
        if (url && typeof url === 'string') {
            await shell.openExternal(url);
        }
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
        updateApplicationMenu().catch(err => console.error("Error updating menu:", err));
    });

    // Set window title
    ipcMain.on('set-title', (event, title: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.setTitle(title);
            // Update menu to reflect new window title
            updateApplicationMenu().catch(err => console.error("Error updating menu:", err));
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
            // console.log('[SET_FILE] SKIPPED - file path unchanged:', basename(filePath || ''), 'windowId:', windowId);
            return;
        }

        // console.log('[SET_FILE] File path change for windowId', windowId, 'from', state?.filePath ? basename(state.filePath) : 'null', 'to', filePath ? basename(filePath) : 'null');

        if (state) {

            state.filePath = filePath;
            // console.log('[SET_FILE] Window state after update:', { windowId, filePath: state.filePath });

            // Update menu to reflect new file
            updateApplicationMenu().catch(err => console.error("Error updating menu:", err));

            // Start watching the new file
            if (filePath) {
                // console.log('[SET_FILE] Starting watcher for file:', basename(filePath), 'windowId:', windowId);
                startFileWatcher(window, filePath);
            }
        } else {
            console.log('[SET_FILE] WARNING: No window state found for window', windowId);
        }
        // console.log('[SET_FILE] Current file path updated from renderer:', filePath);
    });

    // Open image in default application
    ipcMain.handle('image:open-in-default-app', async (event, imagePath: string) => {
        try {
            // Handle data URLs by creating a temp file
            if (imagePath.startsWith('data:')) {
                const tempPath = await createTempFileFromDataURL(imagePath);
                if (tempPath) {
                    await shell.openPath(tempPath);
                    return { success: true };
                } else {
                    return { success: false, error: 'Failed to create temp file from data URL' };
                }
            }

            // Handle file:// URLs
            let filePath = imagePath;
            if (filePath.startsWith('file://')) {
                filePath = filePath.replace('file://', '');
            }

            // Check if file exists
            if (!existsSync(filePath)) {
                return { success: false, error: 'File does not exist' };
            }

            // Open in default application
            const result = await shell.openPath(filePath);
            if (result) {
                // openPath returns an error string if it failed, empty string on success
                return { success: false, error: result };
            }
            return { success: true };
        } catch (error: any) {
            console.error('[IMAGE] Failed to open image:', error);
            return { success: false, error: error.message };
        }
    });

    // Start native drag for image
    ipcMain.handle('image:start-drag', async (event, imagePath: string) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) {
                return { success: false, error: 'Window not found' };
            }

            // Handle data URLs by creating a temp file
            if (imagePath.startsWith('data:')) {
                const tempPath = await createTempFileFromDataURL(imagePath);
                if (!tempPath) {
                    return { success: false, error: 'Failed to create temp file from data URL' };
                }
                imagePath = tempPath;
            }

            // Handle file:// URLs
            let filePath = imagePath;
            if (filePath.startsWith('file://')) {
                filePath = filePath.replace('file://', '');
            }

            // Check if file exists
            if (!existsSync(filePath)) {
                return { success: false, error: 'File does not exist' };
            }

            // Create icon for drag preview
            const icon = nativeImage.createFromPath(filePath);

            // Start drag operation
            event.sender.startDrag({
                file: filePath,
                icon: icon.resize({ width: 64, height: 64 })
            });

            return { success: true };
        } catch (error: any) {
            console.error('[IMAGE] Failed to start drag:', error);
            return { success: false, error: error.message };
        }
    });
}

// Helper function to create a temp file from a data URL
async function createTempFileFromDataURL(dataURL: string): Promise<string | null> {
    try {
        // Parse data URL: data:image/png;base64,iVBORw0KGgo...
        const matches = dataURL.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) {
            console.error('[IMAGE] Invalid data URL format');
            return null;
        }

        const mimeType = matches[1];
        const base64Data = matches[2];

        // Determine file extension from MIME type
        const extensionMap: Record<string, string> = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
        };
        const extension = extensionMap[mimeType] || 'png';

        // Create temp file
        const tempPath = join(tmpdir(), `image-${Date.now()}.${extension}`);
        const buffer = Buffer.from(base64Data, 'base64');
        writeFileSync(tempPath, buffer);

        return tempPath;
    } catch (error) {
        console.error('[IMAGE] Failed to create temp file:', error);
        return null;
    }
}

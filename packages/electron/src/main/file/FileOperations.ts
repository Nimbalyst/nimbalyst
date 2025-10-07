import { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { windowStates, getWindowId } from '../window/WindowManager';
import { addToRecentItems } from '../utils/store';
import { startFileWatcher } from './FileWatcher';

// Function to load file into window
export function loadFileIntoWindow(window: BrowserWindow, filePath: string) {
    try {
        console.log('[LOAD_FILE] Loading file into window:', filePath, 'window:', window.id);
        const content = readFileSync(filePath, 'utf-8');
        const windowId = getWindowId(window);
        if (windowId === null) {
            console.error('[LOAD_FILE] Failed to find custom window ID');
            return;
        }
        const state = windowStates.get(windowId);

        if (state) {
            state.filePath = filePath;
            state.documentEdited = false;
        } else {
            console.error('[LOAD_FILE] No window state found for window ID:', windowId);
        }

        console.log('[LOAD_FILE] Sending file-opened-from-os event to window', window.id);
        console.log('[LOAD_FILE] Event payload:', { filePath, contentLength: content.length });
        window.webContents.send('file-opened-from-os', { filePath, content });
        console.log('[LOAD_FILE] Event sent successfully');

        // Set represented filename for macOS
        if (process.platform === 'darwin') {
            window.setRepresentedFilename(filePath);
        }

        // Add to recent documents
        addToRecentItems('documents', filePath, basename(filePath));

        // Start watching the file for changes
        // console.log('[LOAD_FILE] Starting file watcher');
        startFileWatcher(window, filePath);

    } catch (error) {
        console.error('[LOAD_FILE] Error loading file from OS:', error);
    }
}

// Save file
export function saveFile(filePath: string, content: string): void {
    writeFileSync(filePath, content, 'utf-8');
}

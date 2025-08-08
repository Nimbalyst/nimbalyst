import { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';
import { windowStates } from '../window/WindowManager';
import { addToRecentItems } from '../utils/store';
import { startFileWatcher } from './FileWatcher';

// Function to load file into window
export function loadFileIntoWindow(window: BrowserWindow, filePath: string) {
    try {
        console.log('[LOAD_FILE] Loading file into window:', filePath, 'window:', window.id);
        const content = readFileSync(filePath, 'utf-8');
        const windowId = window.id;
        const state = windowStates.get(windowId);
        
        if (state) {
            state.filePath = filePath;
            state.documentEdited = false;
        }
        
        console.log('[LOAD_FILE] Sending file-opened-from-os event');
        window.webContents.send('file-opened-from-os', { filePath, content });
        
        // Set represented filename for macOS
        if (process.platform === 'darwin') {
            window.setRepresentedFilename(filePath);
        }
        
        // Add to recent documents
        addToRecentItems('documents', filePath, basename(filePath));
        
        // Start watching the file for changes
        console.log('[LOAD_FILE] Starting file watcher');
        startFileWatcher(window, filePath);
        
    } catch (error) {
        console.error('[LOAD_FILE] Error loading file from OS:', error);
    }
}

// Save file
export function saveFile(filePath: string, content: string): void {
    writeFileSync(filePath, content, 'utf-8');
}
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { windowStates, savingWindows, findWindowByFilePath, createWindow } from '../window/WindowManager';
import { loadFileIntoWindow, saveFile } from '../file/FileOperations';
import { startFileWatcher, stopFileWatcher } from '../file/FileWatcher';
import { AUTOSAVE_DELAY } from '../utils/constants';
import { addProjectRecentFile } from '../utils/store';

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
            const windowId = window.id;
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
        if (!window) return null;
        
        const windowId = window.id;
        const state = windowStates.get(windowId);
        const filePath = state?.filePath;
        
        console.log('[SAVE] save-file handler called');
        console.log('[SAVE] Window ID:', windowId);
        console.log('[SAVE] Window state:', state);
        console.log('[SAVE] File path from state:', filePath);
        
        try {
            if (!filePath) {
                console.log('[SAVE] No current file path for this window - state exists:', !!state);
                return null;
            }
            
            // Mark that we're saving to prevent file watcher from reacting
            savingWindows.add(windowId);
            console.log('[SAVE] Marked window as saving:', windowId);
            
            console.log('[SAVE] Writing to file:', filePath);
            saveFile(filePath, content);
            
            if (state) {
                state.documentEdited = false; // Reset dirty state after save
            }
            
            // Clear the saving flag after a delay to ensure the file watcher doesn't react
            setTimeout(() => {
                savingWindows.delete(windowId);
                console.log('[SAVE] Cleared saving flag for window:', windowId);
            }, AUTOSAVE_DELAY);
            
            return { success: true, filePath };
        } catch (error) {
            console.error('Error saving file:', error);
            return null;
        }
    });
    
    // Save file as
    ipcMain.handle('save-file-as', async (event, content: string) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return null;
        
        const windowId = window.id;
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
    
    // Update current file path from renderer (for drag-drop)
    ipcMain.handle('set-current-file', async (event, filePath: string | null) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;
        
        const windowId = window.id;
        const state = windowStates.get(windowId);
        
        if (state) {
            // Stop watching the old file
            if (state.filePath && state.filePath !== filePath) {
                console.log('[SET_FILE] Stopping watcher for old file:', state.filePath);
                stopFileWatcher(windowId);
            }
            
            state.filePath = filePath;
            
            // Start watching the new file
            if (filePath) {
                console.log('[SET_FILE] Starting watcher for new file:', filePath);
                startFileWatcher(window, filePath);
            }
        }
        
        console.log('[SET_FILE] Current file path updated from renderer:', filePath);
    });
}
import { BrowserWindow } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { windows, windowStates, createWindow } from '../window/WindowManager';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getSessionState, saveSessionState as saveToStore, SessionState } from '../utils/store';
import { startProjectWatcher } from '../file/ProjectWatcher';
import { getFolderContents } from '../utils/FileTree';
import { basename } from 'path';

// Save session state
export function saveSessionState() {
    const sessionWindows: any[] = [];

    for (const [windowId, window] of windows) {
        const state = windowStates.get(windowId);
        if (!state || window.isDestroyed()) continue;

        // Don't save untitled empty documents
        if (state.mode === 'document' && !state.filePath && !state.documentEdited) {
            continue;
        }

        const bounds = window.getBounds();
        const sessionWindow: any = {
            mode: state.mode,
            bounds
        };

        if (state.filePath) {
            sessionWindow.filePath = state.filePath;
        }
        if (state.projectPath) {
            sessionWindow.projectPath = state.projectPath;
        }

        sessionWindows.push(sessionWindow);
    }

    const sessionState: SessionState = {
        windows: sessionWindows,
        lastUpdated: Date.now()
    };

    saveToStore(sessionState);
    console.log('[SESSION] Saved session state:', sessionState);
}

// Restore session state
export function restoreSessionState(): boolean {
    const sessionState = getSessionState();

    if (!sessionState || !sessionState.windows || sessionState.windows.length === 0) {
        console.log('[SESSION] No session to restore');
        return false;
    }

    console.log('[SESSION] Restoring session:', sessionState);

    // Restore each window
    sessionState.windows.forEach((sessionWindow, index) => {
        // Add a small delay between windows to avoid race conditions
        setTimeout(() => {
            if (sessionWindow.mode === 'project' && sessionWindow.projectPath) {
                // Check if project path still exists
                if (existsSync(sessionWindow.projectPath)) {
                    // Restore project window
                    const window = createWindow(false, true, sessionWindow.projectPath, sessionWindow.bounds);
                    console.log('[SESSION] Restored project window:', sessionWindow.projectPath);

                    // If there was a file open in the project, restore it
                    if (sessionWindow.filePath && existsSync(sessionWindow.filePath)) {
                        window.once('ready-to-show', () => {
                            // Wait a bit for the project to load
                            setTimeout(() => {
                                window.webContents.send('file-opened-from-os', {
                                    filePath: sessionWindow.filePath,
                                    content: readFileSync(sessionWindow.filePath, 'utf-8')
                                });

                                // Update window state
                                const windowId = window.id;
                                const state = windowStates.get(windowId);
                                if (state) {
                                    state.filePath = sessionWindow.filePath;
                                }
                            }, 500);
                        });
                        console.log('[SESSION] Restored file in project:', sessionWindow.filePath);
                    }
                } else {
                    console.log('[SESSION] Project path no longer exists:', sessionWindow.projectPath);
                }
            } else if (sessionWindow.mode === 'document' && sessionWindow.filePath) {
                // Check if file still exists
                if (existsSync(sessionWindow.filePath)) {
                    // Restore document window
                    const window = createWindow(true, false, undefined, sessionWindow.bounds);
                    window.once('ready-to-show', () => {
                        loadFileIntoWindow(window, sessionWindow.filePath!);
                    });
                    console.log('[SESSION] Restored document window:', sessionWindow.filePath);
                } else {
                    console.log('[SESSION] File no longer exists:', sessionWindow.filePath);
                }
            }
        }, index * 100);
    });

    return true;
}
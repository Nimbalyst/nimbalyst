import { BrowserWindow } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { windows, windowStates, createWindow, windowFocusOrder, windowDevToolsState } from '../window/WindowManager';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getSessionState, saveSessionState as saveToStore, SessionState } from '../utils/store';
import { startProjectWatcher } from '../file/ProjectWatcher';
import { getFolderContents } from '../utils/FileTree';
import { basename } from 'path';
import { logger } from '../utils/logger';

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
        const focusOrder = windowFocusOrder.get(windowId) || 0;
        const devToolsOpen = windowDevToolsState.get(windowId) || false;
        const sessionWindow: any = {
            mode: state.mode,
            bounds,
            focusOrder,
            devToolsOpen
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
    // logger.session.debug('Saved session state:', sessionState);
}

// Restore session state
export function restoreSessionState(): boolean {
    const sessionState = getSessionState();

    if (!sessionState || !sessionState.windows || sessionState.windows.length === 0) {
        logger.session.info('No session to restore');
        return false;
    }

    logger.session.info('Restoring session:', sessionState);

    // Sort windows by focus order (lower order first, so they're created in background)
    const sortedWindows = [...sessionState.windows].sort((a, b) => {
        const aOrder = a.focusOrder || 0;
        const bOrder = b.focusOrder || 0;
        return aOrder - bOrder;
    });

    // Track the window with highest focus order to focus it last
    let lastFocusedWindow: BrowserWindow | null = null;
    let highestFocusOrder = -1;

    // Restore each window
    sortedWindows.forEach((sessionWindow, index) => {
        // Add a small delay between windows to avoid race conditions
        setTimeout(() => {
            let window: BrowserWindow | null = null;

            if (sessionWindow.mode === 'project' && sessionWindow.projectPath) {
                // Check if project path still exists
                if (existsSync(sessionWindow.projectPath)) {
                    // Restore project window
                    window = createWindow(false, true, sessionWindow.projectPath, sessionWindow.bounds);
                    logger.session.info(`Restored project window: ${sessionWindow.projectPath}`);

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
                        logger.session.info(`Restored file in project: ${sessionWindow.filePath}`);
                    }
                } else {
                    logger.session.warn(`Project path no longer exists: ${sessionWindow.projectPath}`);
                }
            } else if (sessionWindow.mode === 'document' && sessionWindow.filePath) {
                // Check if file still exists
                if (existsSync(sessionWindow.filePath)) {
                    // Restore document window
                    window = createWindow(true, false, undefined, sessionWindow.bounds);
                    window.once('ready-to-show', () => {
                        loadFileIntoWindow(window, sessionWindow.filePath!);
                    });
                    logger.session.info(`Restored document window: ${sessionWindow.filePath}`);
                } else {
                    logger.session.warn(`File no longer exists: ${sessionWindow.filePath}`);
                }
            }

            // Track window with highest focus order
            if (window) {
                const focusOrder = sessionWindow.focusOrder || 0;
                if (focusOrder > highestFocusOrder) {
                    highestFocusOrder = focusOrder;
                    lastFocusedWindow = window;
                }
                
                // Restore dev tools state
                if (sessionWindow.devToolsOpen) {
                    // Wait for window to be ready before opening dev tools
                    window.webContents.once('did-finish-load', () => {
                        window.webContents.openDevTools();
                    });
                }
            }
        }, index * 100);
    });

    // Focus the last focused window after all windows are created
    if (lastFocusedWindow) {
        setTimeout(() => {
            if (lastFocusedWindow && !lastFocusedWindow.isDestroyed()) {
                lastFocusedWindow.focus();
                logger.session.debug('Focused last active window');
            }
        }, sortedWindows.length * 100 + 200);
    }

    return true;
}

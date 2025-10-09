import { BrowserWindow } from 'electron';
import { existsSync, readFileSync } from 'fs';
import { windows, windowStates, createWindow, windowFocusOrder, windowDevToolsState, getWindowId } from '../window/WindowManager';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getSessionState, saveSessionState as saveToStore, SessionState } from '../utils/store';
import { startWorkspaceWatcher } from '../file/WorkspaceWatcher.ts';
import { getFolderContents } from '../utils/FileTree';
import { basename } from 'path';
import { logger } from '../utils/logger';
import { createAgenticCodingWindow } from '../window/AgenticCodingWindow';

// Save session state
export async function saveSessionState() {
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
        if (state.workspacePath) {
            sessionWindow.workspacePath = state.workspacePath;
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
export async function restoreSessionState(): Promise<boolean> {
    // Skip session restoration in test mode
    if (process.env.PLAYWRIGHT === '1') {
        logger.session.info('Skipping session restoration in test mode');
        return false;
    }

    const sessionState = getSessionState();

    if (!sessionState || !sessionState.windows || sessionState.windows.length === 0) {
        return false;
    }

    logger.session.info(`Restoring session with ${sessionState.windows.length} window(s)`);

    // Sort windows by focus order - LOWEST first, HIGHEST last
    // This way the last-focused window is created last and naturally gets focus
    const sortedWindows = [...sessionState.windows].sort((a, b) => {
        const aOrder = a.focusOrder || 0;
        const bOrder = b.focusOrder || 0;
        return aOrder - bOrder;
    });

    logger.session.info(`Window creation order (by focusOrder):`, sortedWindows.map((w, i) =>
        `${i}: ${w.mode} focusOrder=${w.focusOrder}`
    ));

    // Restore each window in order - last one created will naturally get focus
    sortedWindows.forEach((sessionWindow, index) => {
        // Add a small delay between windows to ensure they're created in order
        setTimeout(() => {
            let window: BrowserWindow | null = null;

            if (sessionWindow.mode === 'workspace' && sessionWindow.workspacePath) {
                // Check if workspace path still exists
                if (existsSync(sessionWindow.workspacePath)) {
                    // Restore workspace window
                    window = createWindow(false, true, sessionWindow.workspacePath, sessionWindow.bounds);
                    logger.session.info(`Restored workspace window: ${sessionWindow.workspacePath}`);

                    // Note: Workspace tabs will be restored by the workspace's own tab state management
                    // We don't manually open files here to avoid interfering with tab restoration
                } else {
                    logger.session.warn(`Workspace path no longer exists: ${sessionWindow.workspacePath}`);
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
            } else if (sessionWindow.mode === 'agentic-coding' && sessionWindow.workspacePath) {
                // Check if workspace path still exists
                if (existsSync(sessionWindow.workspacePath)) {
                    // Restore agentic coding window
                    window = createAgenticCodingWindow({
                        workspacePath: sessionWindow.workspacePath
                    });
                    logger.session.info(`Restored agentic coding window: ${sessionWindow.workspacePath}`);
                } else {
                    logger.session.warn(`Workspace path no longer exists: ${sessionWindow.workspacePath}`);
                }
            }

            // Restore dev tools state
            if (window && sessionWindow.devToolsOpen) {
                // Wait for window to be ready before opening dev tools
                window.webContents.once('did-finish-load', () => {
                    window.webContents.openDevTools();
                });
            }
        }, index * 200);  // 200ms delay between each window creation
    });

    return true;
}

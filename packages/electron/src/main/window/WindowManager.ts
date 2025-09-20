import { BrowserWindow, dialog, app, nativeImage, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { WindowState, FileTreeItem } from '../types';
import { WINDOW_CASCADE_OFFSET } from '../utils/constants';
import { getTheme, saveWorkspaceWindowState } from '../utils/store';
import { stopFileWatcher } from '../file/FileWatcher';
import { stopWorkspaceWatcher, startWorkspaceWatcher } from '../file/WorkspaceWatcher.ts';
import { getFolderContents } from '../utils/FileTree';
import { getTitleBarColors } from '../theme/ThemeManager';
import { ElectronDocumentService, setupDocumentServiceHandlers } from '../services/ElectronDocumentService';
import { ElectronFileSystemService } from '../services/ElectronFileSystemService';
import { setFileSystemService, clearFileSystemService } from '@stravu/runtime';

// Window management
export const windows = new Map<number, BrowserWindow>();
export const windowStates = new Map<number, WindowState>();
export const savingWindows = new Set<number>();
export const windowFocusOrder = new Map<number, number>(); // Track focus order for each window
export const windowDevToolsState = new Map<number, boolean>(); // Track dev tools state for each window

// Store document services for each workspace
const documentServices = new Map<string, ElectronDocumentService>();
// Store file system services for each workspace
const fileSystemServices = new Map<string, ElectronFileSystemService>();

function resolveDocumentServiceForEvent(event: IpcMainEvent | IpcMainInvokeEvent): ElectronDocumentService | null {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow) {
        console.log('[DocumentService] No browser window from event');
        return null;
    }
    const windowId = getWindowId(browserWindow);
    if (windowId === null) {
        console.log('[DocumentService] No window ID');
        return null;
    }
    const state = windowStates.get(windowId);
    if (!state || state.mode !== 'workspace' || !state.workspacePath) {
        console.log('[DocumentService] Window not in workspace mode or no path:', {
            hasState: !!state,
            mode: state?.mode,
            hasPath: !!state?.workspacePath
        });
        return null;
    }
    const service = documentServices.get(state.workspacePath);
    console.log('[DocumentService] Resolved service for path:', state.workspacePath, '-> found:', !!service);
    return service ?? null;
}

let windowIdCounter = 0;
let windowPositionOffset = 0;
let untitledCounter = 0;
let focusOrderCounter = 0; // Counter for tracking focus order

// Track whether the app is in the process of quitting so we don't block window close
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});

// Get focused window or create new one
export function getFocusedOrNewWindow(): BrowserWindow {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
        return focusedWindow;
    }

    // If no focused window, create a new one
    return createWindow();
}

export function createWindow(
    isOpeningFile: boolean = false,
    isWorkspaceMode: boolean = false,
    workspacePath: string | null = null,
    savedBounds?: { x: number; y: number; width: number; height: number }
): BrowserWindow {
    const startTime = Date.now();
    try {
        console.log('[MAIN] Creating window at', new Date().toISOString());

        // Set up icon path based on platform
        let iconPath: string | undefined;

        if (process.platform === 'darwin') {
            iconPath = join(__dirname, '../../resources/icon.png');
        } else if (process.platform === 'win32') {
            iconPath = join(__dirname, '../../resources/icon.png');
        } else {
            iconPath = join(__dirname, '../../resources/icon.png');
        }

        // Check if icon exists
        if (!existsSync(iconPath)) {
            console.log('[MAIN] Icon not found at:', iconPath);
            iconPath = undefined;
        } else {
            console.log('[MAIN] Using icon at:', iconPath);
        }

        // Calculate window position with cascading effect
        let x: number | undefined;
        let y: number | undefined;
        let width = 1024;
        let height = 768;

        if (savedBounds) {
            // Use saved bounds from session
            x = savedBounds.x;
            y = savedBounds.y;
            width = savedBounds.width;
            height = savedBounds.height;
        } else {
            // Get the display containing the cursor
            const { screen } = require('electron');
            const cursorPoint = screen.getCursorScreenPoint();
            const display = screen.getDisplayNearestPoint(cursorPoint);

            // Calculate position with cascading offset
            x = display.bounds.x + 100 + windowPositionOffset;
            y = display.bounds.y + 100 + windowPositionOffset;

            // Update offset for next window (wrap around after 10 windows)
            windowPositionOffset = (windowPositionOffset + WINDOW_CASCADE_OFFSET) % (WINDOW_CASCADE_OFFSET * 10);

            // Make sure window is not off screen
            if (x + width > display.bounds.x + display.bounds.width) {
                x = display.bounds.x + 100;
            }
            if (y + height > display.bounds.y + display.bounds.height) {
                y = display.bounds.y + 100;
            }
        }

        // Determine the current theme and set appropriate background color
        const currentTheme = getTheme();
        let backgroundColor = '#ffffff'; // Default to white for light theme

        if (currentTheme === 'dark' || currentTheme === 'crystal-dark') {
            backgroundColor = '#1e1e1e';
        } else if (currentTheme === 'system') {
            const { nativeTheme } = require('electron');
            if (nativeTheme.shouldUseDarkColors) {
                backgroundColor = '#1e1e1e';
            }
        }

        const windowOptions: Electron.BrowserWindowConstructorOptions = {
            width,
            height,
            x,
            y,
            title: isWorkspaceMode && workspacePath ? basename(workspacePath) : 'Preditor',
            backgroundColor,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: join(__dirname, '../preload/index.js'),
                webSecurity: false,
                webviewTag: false
            },
            show: false,
            titleBarStyle: process.platform === 'darwin' ? undefined : 'default',
        };

        if (iconPath) {
            windowOptions.icon = nativeImage.createFromPath(iconPath);
        }

        const window = new BrowserWindow(windowOptions);

        // Generate a unique window ID
        const windowId = ++windowIdCounter;
        console.log('[MAIN] Created window with ID:', windowId, 'Electron ID:', window.id);

        // Store window and initial state
        windows.set(windowId, window);
        windowStates.set(windowId, {
            mode: isWorkspaceMode ? 'workspace' : 'document',
            filePath: null,
            workspacePath: isWorkspaceMode ? workspacePath : null,
            documentEdited: false
        });
        if (isWorkspaceMode && workspacePath) {
            if (!documentServices.has(workspacePath)) {
                const docService = new ElectronDocumentService(workspacePath);
                documentServices.set(workspacePath, docService);
                setupDocumentServiceHandlers(resolveDocumentServiceForEvent);
                console.log('[MAIN] Created DocumentService for workspace:', workspacePath);
            }
            if (!fileSystemServices.has(workspacePath)) {
                const fileSystemService = new ElectronFileSystemService(workspacePath);
                fileSystemServices.set(workspacePath, fileSystemService);
                // Set the file system service globally for the runtime
                setFileSystemService(fileSystemService);
                console.log('[MAIN] Created FileSystemService for workspace:', workspacePath);
            }
        }
        windowFocusOrder.set(windowId, ++focusOrderCounter); // Track initial focus order

        console.log('[MAIN] Window stored in maps. Mode:', isWorkspaceMode ? 'workspace' : 'document');
        console.log('[MAIN] Windows Map now has:', windows.size, 'windows');
        console.log('[MAIN] Window IDs in map:', [...windows.keys()]);

        // Increase max listeners to avoid warning (we have multiple event handlers)
        window.webContents.setMaxListeners(20);

        // Capture console messages from renderer (for debugging)
        if (process.env.NODE_ENV !== 'production') {
            window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
                const levelNames = ['verbose', 'info', 'warning', 'error'];
                const levelName = levelNames[level] || 'unknown';

                // Send to main process for file logging
                const timestamp = new Date().toISOString();
                const logData = {
                    timestamp,
                    level: levelName,
                    source: sourceId || 'renderer',
                    message: `${message} ${line ? `(line ${line})` : ''}`
                };

                // Emit to IPC for file logging
                ipcMain.emit('console-log', null, logData);
            });
        }

        // Handle window close with unsaved changes (skip prompts when quitting)
        window.on('close', (event) => {
            if (isQuitting) {
                // Allow close to proceed without prompts during app quit
                return;
            }
            const state = windowStates.get(windowId);
            if (state?.documentEdited) {
                event.preventDefault();
                const choice = dialog.showMessageBoxSync(window, {
                    type: 'question',
                    buttons: ['Save', 'Don\'t Save', 'Cancel'],
                    defaultId: 0,
                    cancelId: 2,
                    message: 'Do you want to save the changes you made?',
                    detail: 'Your changes will be lost if you don\'t save them.'
                });

                if (choice === 0) {
                    // Save
                    window.webContents.send('save-before-close');
                    // Wait a bit for save to complete
                    setTimeout(() => {
                        const currentState = windowStates.get(windowId);
                        if (!currentState?.documentEdited) {
                            window.destroy();
                        }
                    }, 100);
                } else if (choice === 1) {
                    // Don't save
                    window.destroy();
                }
                // choice === 2: Cancel, do nothing
            }
        });

        window.on('close', (event) => {
            // Save workspace-specific window state before closing
            const state = windowStates.get(windowId);
            if (state?.mode === 'workspace' && state.workspacePath) {
                const bounds = window.getBounds();
                const focusOrder = windowFocusOrder.get(windowId) || 0;
                const devToolsOpen = windowDevToolsState.get(windowId) || false;

                saveWorkspaceWindowState(state.workspacePath, {
                    mode: 'workspace',
                    workspacePath: state.workspacePath,
                    filePath: state.filePath,
                    bounds,
                    focusOrder,
                    devToolsOpen
                });
            }
        });

        window.on('closed', () => {
            windows.delete(windowId);
            const state = windowStates.get(windowId);
            windowStates.delete(windowId);
            savingWindows.delete(windowId);
            windowFocusOrder.delete(windowId);
            windowDevToolsState.delete(windowId);
            stopFileWatcher(windowId);
            stopWorkspaceWatcher(windowId);

            // Clean up document service if this was the last window for the workspace
            if (state?.mode === 'workspace' && state.workspacePath) {
                // Check if any other windows are using this workspace
                const otherWorkspaceWindows = Array.from(windowStates.values())
                    .filter(s => s.mode === 'workspace' && s.workspacePath === state.workspacePath);

                if (otherWorkspaceWindows.length === 0) {
                    // Clean up document service if no other windows are using it
                    const docService = documentServices.get(state.workspacePath);
                    if (docService) {
                        docService.destroy();
                        documentServices.delete(state.workspacePath);
                        console.log('[MAIN] Destroyed DocumentService for workspace:', state.workspacePath);
                    }
                    // Clean up file system service
                    const fileSystemService = fileSystemServices.get(state.workspacePath);
                    if (fileSystemService) {
                        fileSystemService.destroy();
                        fileSystemServices.delete(state.workspacePath);
                        clearFileSystemService();
                        console.log('[MAIN] Destroyed FileSystemService for workspace:', state.workspacePath);
                    }
                }
            }
            // Update menu to reflect window closure
            // This will be handled by the menu system
        });

        // Save session state when window is created
        import('../session/SessionState').then(({ saveSessionState }) => {
            setTimeout(async () => {
                await saveSessionState();
            }, 1000);
        });

        // Update menu when window gains/loses focus
        window.on('focus', () => {
            // Update focus order
            windowFocusOrder.set(windowId, ++focusOrderCounter);
            // This will be handled by the menu system
        });

        window.on('blur', () => {
            // This will be handled by the menu system
        });

        // Track dev tools state
        window.webContents.on('devtools-opened', () => {
            windowDevToolsState.set(windowId, true);
        });

        window.webContents.on('devtools-closed', () => {
            windowDevToolsState.set(windowId, false);
        });

        // Load the HTML file with error handling
        const loadContent = () => {
            if (process.env.NODE_ENV === 'development') {
                console.log('[MAIN] Loading from dev server');
                return window.loadURL('http://localhost:5273');
            } else {
                console.log('[MAIN] Loading from built files');
                // Use loadFile which handles App Translocation properly
                const htmlPath = join(__dirname, '../renderer/index.html');
                return window.loadFile(htmlPath);
            }
        };

        loadContent().catch(err => {
            console.error('[MAIN] Failed to load window content:', err);
            // Try to reload once
            setTimeout(() => {
                if (!window.isDestroyed()) {
                    loadContent().catch(err2 => {
                        console.error('[MAIN] Failed to reload window content:', err2);
                    });
                }
            }, 1000);
        });

        // Show window when ready
        window.once('ready-to-show', () => {
            console.log('[MAIN] Window ready to show at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
            window.show();
        });

        // Handle renderer process crashes
        window.webContents.on('render-process-gone', (event, details) => {
            console.error('[MAIN] Renderer process gone:', details);
            if (!window.isDestroyed()) {
                // Reload the window
                window.reload();
            }
        });

        // Handle unresponsive renderer
        window.webContents.on('unresponsive', () => {
            console.warn('[MAIN] Window became unresponsive');
            const { dialog } = require('electron');
            const choice = dialog.showMessageBoxSync(window, {
                type: 'warning',
                buttons: ['Reload', 'Keep Waiting'],
                defaultId: 0,
                message: 'The window is not responding',
                detail: 'Would you like to reload the window?'
            });

            if (choice === 0 && !window.isDestroyed()) {
                window.reload();
            }
        });

        // Handle responsive again
        window.webContents.on('responsive', () => {
            console.log('[MAIN] Window became responsive again');
        });

        // When the window is ready, send initial data
        window.webContents.once('did-finish-load', () => {
            console.log('[MAIN] did-finish-load at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');

            // Send the current theme to the new window
            const theme = getTheme();
            window.webContents.send('theme-change', theme);

            if (isWorkspaceMode && workspacePath) {
                // Don't send 'workspace-opened' here - the renderer already knows it's in workspace mode
                // from the initial state. Sending this event causes the tabs to be cleared.
                // Just start watching the workspace directory for changes
                setTimeout(() => {
                    startWorkspaceWatcher(window, workspacePath);
                }, 100);
            } else if (!isOpeningFile) {
                // Create new untitled document
                untitledCounter++;
                const untitledName = untitledCounter === 1 ? 'Untitled' : `Untitled ${untitledCounter}`;
                setTimeout(() => {
                    window.webContents.send('new-untitled-document', { untitledName });
                }, 100);
            }
        });

        console.log('[MAIN] Window created successfully at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
        return window;

    } catch (error) {
        console.error('Error creating window:', error);
        throw error;
    }
}

// Find window by file path
export function findWindowByFilePath(filePath: string): BrowserWindow | null {
    for (const [windowId, window] of windows) {
        const state = windowStates.get(windowId);
        if (state?.filePath === filePath) {
            return window;
        }
    }
    return null;
}

// Find custom window ID from BrowserWindow
export function getWindowId(browserWindow: BrowserWindow): number | null {
    for (const [windowId, window] of windows) {
        if (window === browserWindow) {
            return windowId;
        }
    }
    return null;
}

// Update window title
export function updateWindowTitle(window: BrowserWindow) {
    const windowId = getWindowId(window);
    if (windowId === null) {
        console.error('[WindowManager] Failed to find custom window ID for title update');
        return;
    }
    const state = windowStates.get(windowId);
    let title = 'Untitled';

    if (state) {
        if (state.mode === 'workspace' && state.workspacePath) {
            const workspaceName = basename(state.workspacePath);
            if (state.filePath) {
                const fileName = basename(state.filePath);
                title = `${fileName} - ${workspaceName}`;
            } else {
                title = workspaceName;
            }
        } else if (state.filePath) {
            title = basename(state.filePath);
        }

        // Add dirty indicator
        if (state.documentEdited) {
            title = `${title} •`;
        }
    }

    window.setTitle(title);
}

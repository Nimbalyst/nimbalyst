import { BrowserWindow, dialog, app, nativeImage } from 'electron';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { WindowState, FileTreeItem } from '../types';
import { WINDOW_CASCADE_OFFSET } from '../utils/constants';
import { getTheme, saveProjectWindowState } from '../utils/store';
import { stopFileWatcher } from '../file/FileWatcher';
import { stopProjectWatcher } from '../file/ProjectWatcher';
import { getFolderContents } from '../utils/FileTree';
import { getTitleBarColors } from '../theme/ThemeManager';

// Window management
export const windows = new Map<number, BrowserWindow>();
export const windowStates = new Map<number, WindowState>();
export const savingWindows = new Set<number>();
export const windowFocusOrder = new Map<number, number>(); // Track focus order for each window
export const windowDevToolsState = new Map<number, boolean>(); // Track dev tools state for each window

let windowIdCounter = 0;
let windowPositionOffset = 0;
let untitledCounter = 0;
let focusOrderCounter = 0; // Counter for tracking focus order

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
    isProjectMode: boolean = false, 
    projectPath: string | null = null, 
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
            title: isProjectMode && projectPath ? basename(projectPath) : 'Stravu Editor',
            backgroundColor,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: join(__dirname, '../preload/index.js'),
                webSecurity: true
            },
            show: false,
            titleBarStyle: process.platform === 'darwin' ? undefined : 'hidden',
            titleBarOverlay: process.platform !== 'darwin' ? getTitleBarColors() : false,
        };

        if (iconPath) {
            windowOptions.icon = nativeImage.createFromPath(iconPath);
        }

        const window = new BrowserWindow(windowOptions);

        // Generate a unique window ID
        const windowId = ++windowIdCounter;
        console.log('[MAIN] Created window with ID:', windowId);

        // Store window and initial state
        windows.set(windowId, window);
        windowStates.set(windowId, {
            mode: isProjectMode ? 'project' : 'document',
            filePath: null,
            projectPath: isProjectMode ? projectPath : null,
            documentEdited: false
        });
        windowFocusOrder.set(windowId, ++focusOrderCounter); // Track initial focus order

        // Handle window close with unsaved changes
        window.on('close', (event) => {
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
            // Save project-specific window state before closing
            const state = windowStates.get(windowId);
            if (state?.mode === 'project' && state.projectPath) {
                const bounds = window.getBounds();
                const focusOrder = windowFocusOrder.get(windowId) || 0;
                const devToolsOpen = windowDevToolsState.get(windowId) || false;
                
                saveProjectWindowState(state.projectPath, {
                    mode: 'project',
                    projectPath: state.projectPath,
                    filePath: state.filePath,
                    bounds,
                    focusOrder,
                    devToolsOpen
                });
            }
        });

        window.on('closed', () => {
            windows.delete(windowId);
            windowStates.delete(windowId);
            savingWindows.delete(windowId);
            windowFocusOrder.delete(windowId);
            windowDevToolsState.delete(windowId);
            stopFileWatcher(windowId);
            stopProjectWatcher(windowId);
            // Update menu to reflect window closure
            // This will be handled by the menu system
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

        // Load the HTML file
        if (process.env.NODE_ENV === 'development') {
            console.log('[MAIN] Loading from dev server');
            window.loadURL('http://localhost:5273');
        } else {
            console.log('[MAIN] Loading from built files');
            window.loadFile(join(__dirname, '../renderer/index.html'));
        }

        // Show window when ready
        window.once('ready-to-show', () => {
            console.log('[MAIN] Window ready to show at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
            window.show();
        });

        // When the window is ready, send initial data
        window.webContents.once('did-finish-load', () => {
            console.log('[MAIN] did-finish-load at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
            
            // Send the current theme to the new window
            const theme = getTheme();
            window.webContents.send('theme-change', theme);

            if (isProjectMode && projectPath) {
                // Send project information to the renderer
                const fileTree = getFolderContents(projectPath);
                setTimeout(() => {
                    window.webContents.send('project-opened', {
                        projectPath,
                        projectName: basename(projectPath),
                        fileTree
                    });
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

// Update window title
export function updateWindowTitle(window: BrowserWindow) {
    const windowId = window.id;
    const state = windowStates.get(windowId);
    let title = 'Untitled';

    if (state) {
        if (state.mode === 'project' && state.projectPath) {
            const projectName = basename(state.projectPath);
            if (state.filePath) {
                const fileName = basename(state.filePath);
                title = `${fileName} - ${projectName}`;
            } else {
                title = projectName;
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
import { BrowserWindow, dialog, app, nativeImage, ipcMain, screen, nativeTheme, Menu, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { WindowState, FileTreeItem } from '../types';
import { WINDOW_CASCADE_OFFSET } from '../utils/constants';
import { getTheme, saveWorkspaceWindowState, getWorkspaceNavigationHistory, saveWorkspaceNavigationHistory } from '../utils/store';
import { stopFileWatcher } from '../file/FileWatcher';
import { stopWorkspaceWatcher, startWorkspaceWatcher } from '../file/WorkspaceWatcher.ts';
import { getFolderContents } from '../utils/FileTree';
import { getTitleBarColors } from '../theme/ThemeManager';
import { ElectronDocumentService, setupDocumentServiceHandlers } from '../services/ElectronDocumentService';
import { ElectronFileSystemService } from '../services/ElectronFileSystemService';
import { setFileSystemService, clearFileSystemService } from '@nimbalyst/runtime';
import { navigationHistoryService } from '../services/NavigationHistoryService';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { FeatureTrackingService } from '../services/analytics/FeatureTrackingService';
import { ExtensionLogService } from '../services/ExtensionLogService';

// Window management
export const windows = new Map<number, BrowserWindow>();
export const windowStates = new Map<number, WindowState>();
export const savingWindows = new Set<number>();
export const windowFocusOrder = new Map<number, number>(); // Track focus order for each window
export const windowDevToolsState = new Map<number, boolean>(); // Track dev tools state for each window

// Store document services for each workspace
export const documentServices = new Map<string, ElectronDocumentService>();
// Store file system services for each workspace
const fileSystemServices = new Map<string, ElectronFileSystemService>();

function resolveDocumentServiceForEvent(event: IpcMainEvent | IpcMainInvokeEvent): ElectronDocumentService | null {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow) {
        // console.log('[DocumentService] No browser window from event');
        return null;
    }
    const windowId = getWindowId(browserWindow);
    if (windowId === null) {
        // console.log('[DocumentService] No window ID');
        return null;
    }
    const state = windowStates.get(windowId);
    // Support both 'workspace' and 'agentic-coding' modes
    if (!state || !state.workspacePath) {
        // console.log('[DocumentService] Window has no workspace path:', {
        //     hasState: !!state,
        //     mode: state?.mode,
        //     hasPath: !!state?.workspacePath
        // });
        return null;
    }
    // Both workspace and agentic-coding windows should have document service access
    if (state.mode !== 'workspace' && state.mode !== 'agentic-coding') {
        // console.log('[DocumentService] Window not in supported mode:', state.mode);
        return null;
    }
    const service = documentServices.get(state.workspacePath);
    // console.log('[DocumentService] Resolved service for path:', state.workspacePath, '-> found:', !!service);
    return service ?? null;
}

let windowIdCounter = 0;
let windowPositionOffset = 0;
let untitledCounter = 0;
let focusOrderCounter = 0; // Counter for tracking focus order

// Export function to increment and get focus order counter
export function incrementFocusOrderCounter(): number {
    return ++focusOrderCounter;
}

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
        // console.log('[MAIN] Creating window at', new Date().toISOString());

        // Set up icon path based on platform
        // In dev mode, use icon from package root; in production, use from resources
        // Use app.getAppPath() for dev mode (not __dirname) because bundled chunks may be in nested directories
        let iconPath: string | undefined;

        if (process.platform === 'darwin') {
            iconPath = app.isPackaged
                ? join(__dirname, '../../resources/icon.png')
                : join(app.getAppPath(), 'icon.png');
        } else if (process.platform === 'win32') {
            iconPath = app.isPackaged
                ? join(__dirname, '../../resources/icon.png')
                : join(app.getAppPath(), 'icon.png');
        } else {
            iconPath = app.isPackaged
                ? join(__dirname, '../../resources/icon.png')
                : join(app.getAppPath(), 'icon.png');
        }

        // Check if icon exists
        if (!existsSync(iconPath)) {
            console.log('[MAIN] Icon not found at:', iconPath);
            iconPath = undefined;
        } else {
            // console.log('[MAIN] Using icon at:', iconPath);
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
        // IMPORTANT: These colors MUST match the CSS theme files exactly to prevent flash
        const currentTheme = getTheme();
        // console.log('[WINDOW-MANAGER] Creating window with theme:', currentTheme);
        let backgroundColor = '#ffffff'; // Default to white for light theme

        if (currentTheme === 'dark') {
            backgroundColor = '#2d2d2d'; // Matches --surface-primary in DarkEditorTheme.css
        } else if (currentTheme === 'crystal-dark') {
            backgroundColor = '#0f172a'; // Matches --surface-primary in CrystalDarkTheme.css
        } else if (currentTheme === 'light') {
            backgroundColor = '#ffffff'; // Matches --surface-primary in PlaygroundEditorTheme.css
        } else {
            // system/auto - use nativeTheme which should match prefers-color-scheme
            backgroundColor = nativeTheme.shouldUseDarkColors ? '#2d2d2d' : '#ffffff';
        }
        // console.log('[WINDOW-MANAGER] Background color:', backgroundColor);

        const windowOptions: Electron.BrowserWindowConstructorOptions = {
            width,
            height,
            x,
            y,
            title: isWorkspaceMode && workspacePath ? basename(workspacePath) : 'Nimbalyst',
            backgroundColor,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                // Preload path: Due to code splitting, __dirname is out/main/chunks/, not out/main/
                // Use app.getAppPath() which returns asar root (packaged) or out/main (playwright)
                preload: (() => {
                    const appPath = app.getAppPath();
                    if (app.isPackaged) {
                        return join(appPath, 'out/preload/index.js');
                    }
                    if (appPath.includes('/out/main') || appPath.includes('\\out\\main')) {
                        return join(appPath, '../preload/index.js');
                    }
                    return join(appPath, 'out/preload/index.js');
                })(),
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
        // console.log('[MAIN] Created window with ID:', windowId, 'Electron ID:', window.id);

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
                // console.log('[MAIN] Created DocumentService for workspace:', workspacePath);
            }
            if (!fileSystemServices.has(workspacePath)) {
                const fileSystemService = new ElectronFileSystemService(workspacePath);
                fileSystemServices.set(workspacePath, fileSystemService);
                // Set the file system service globally for the runtime
                setFileSystemService(fileSystemService);
                // console.log('[MAIN] Created FileSystemService for workspace:', workspacePath);
            }

            // Track workspace feature first use
            const featureTracking = FeatureTrackingService.getInstance();
            if (featureTracking.isFirstUse('workspace')) {
                const daysSinceInstall = featureTracking.getDaysSinceInstall();
                AnalyticsService.getInstance().sendEvent('feature_first_use', {
                    feature: 'workspace',
                    daysSinceInstall,
                });
            }

            // Restore navigation history for this workspace
            const navHistory = getWorkspaceNavigationHistory(workspacePath);
            if (navHistory) {
                navigationHistoryService.restoreNavigationState(windowId, navHistory);
                // console.log('[MAIN] Restored navigation history for workspace:', workspacePath);
            }

            // Note: nimbalyst-local directory is only created when tool packages are installed
            // See PackageService.ensureNimbalystLocalDir and OnboardingService.ensureNimbalystLocalDir
        }
        windowFocusOrder.set(windowId, ++focusOrderCounter); // Track initial focus order

        // console.log('[MAIN] Window stored in maps. Mode:', isWorkspaceMode ? 'workspace' : 'document');
        // console.log('[MAIN] Windows Map now has:', windows.size, 'windows');
        // console.log('[MAIN] Window IDs in map:', [...windows.keys()]);

        // Increase max listeners to avoid warning (we have multiple event handlers)
        window.webContents.setMaxListeners(20);

        // Capture console messages from renderer for debugging and extension log capture
        // Always capture for extension logs, but only emit to IPC in dev mode
        window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            // Always send to extension log service for agent debugging
            ExtensionLogService.getInstance().addRendererLog(level, message, line, sourceId);

            // Only emit to main process file logging in dev mode
            if (process.env.NODE_ENV !== 'production') {
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
            }
        });

        // Handle window close with unsaved changes
        window.on('close', (event) => {
            if (isQuitting) {
                // Allow close to proceed without prompts during app quit
                return;
            }

            const state = windowStates.get(windowId);
            if (state?.documentEdited) {
                event.preventDefault();
                // Send message to renderer to show custom dialog
                window.webContents.send('confirm-close-unsaved');
            }
        });

        // Store state for use in both 'close' and 'closed' handlers
        let savedState: WindowState | undefined;

        window.on('close', (event) => {
            // Save workspace-specific window state before closing
            const state = windowStates.get(windowId);
            savedState = state; // Preserve for 'closed' handler

            if (state?.mode === 'workspace' && state.workspacePath) {
                const bounds = window.getBounds();
                const focusOrder = windowFocusOrder.get(windowId) || 0;
                const devToolsOpen = windowDevToolsState.get(windowId) || false;

                saveWorkspaceWindowState(state.workspacePath, {
                    mode: 'workspace',
                    workspacePath: state.workspacePath,
                    filePath: state.filePath ?? undefined,
                    bounds,
                    focusOrder,
                    devToolsOpen
                });

                // Save navigation history
                const navHistory = navigationHistoryService.saveNavigationState(windowId);
                if (navHistory) {
                    saveWorkspaceNavigationHistory(state.workspacePath, navHistory);
                }
            }

            // Remove from windowStates so saveSessionState() will skip this closing window
            windowStates.delete(windowId);

            // Save global session state (will not include this window since we removed it from windowStates)
            // This ensures closed windows are not restored on next launch
            // SKIP during restart - session state was already saved before windows close
            import('../index').then(({ isRestarting }) => {
                if (isRestarting()) {
                    console.log('[MAIN] Skipping session save during restart (session already saved)');
                    return;
                }
                import('../session/SessionState').then(({ saveSessionState }) => {
                    saveSessionState();
                });
            });
        });

        window.on('closed', () => {
            windows.delete(windowId);
            // Use saved state from 'close' handler
            const state = savedState;
            savingWindows.delete(windowId);
            windowFocusOrder.delete(windowId);
            windowDevToolsState.delete(windowId);
            stopFileWatcher(windowId);
            stopWorkspaceWatcher(windowId);

            // Clean up MCP workspace-to-window mapping
            import('../mcp/httpServer').then(({ unregisterWindow }) => {
                unregisterWindow(windowId);
            }).catch(err => {
                console.error('[MAIN] Error unregistering window from MCP:', err);
            });

            // Clean up navigation history for this window
            navigationHistoryService.removeWindow(windowId);

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

            // Note: We do NOT save global session state here because this window has already
            // been removed from the windows Map. Session state is saved on app quit in main/index.ts
            // which captures all open windows at that moment.

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
            // Add theme to URL query params to prevent flash
            const themeParam = `theme=${currentTheme}`;
            // console.log('[WINDOW-MANAGER] Loading window with theme param:', themeParam);

            // Check for explicit renderer URL from environment (for Playwright tests)
            if (process.env.ELECTRON_RENDERER_URL) {
                const url = new URL(process.env.ELECTRON_RENDERER_URL);
                url.searchParams.set('theme', currentTheme);
                // console.log('[MAIN] Loading from ELECTRON_RENDERER_URL:', url.toString());
                return window.loadURL(url.toString());
            } else if (process.env.NODE_ENV === 'development') {
                // Use VITE_PORT if set (for isolated dev mode), otherwise default to 5273
                const devPort = process.env.VITE_PORT || '5273';
                const url = `http://localhost:${devPort}?${themeParam}`;
                // console.log('[MAIN] Loading from dev server:', url);
                return window.loadURL(url);
            } else {
                // console.log('[MAIN] Loading from built files with theme:', currentTheme);
                // Use loadFile which handles App Translocation properly
                // Note: Due to code splitting, __dirname is out/main/chunks/, not out/main/
                // Use app.getAppPath() to reliably find the renderer
                const appPath = app.getAppPath();
                let htmlPath: string;
                if (app.isPackaged) {
                    // Packaged: app.asar contains out/ at root
                    htmlPath = join(appPath, 'out/renderer/index.html');
                } else if (appPath.includes('/out/main') || appPath.includes('\\out\\main')) {
                    // Playwright running built output: appPath is out/main
                    htmlPath = join(appPath, '../renderer/index.html');
                } else {
                    // Fallback for other built scenarios
                    htmlPath = join(appPath, 'out/renderer/index.html');
                }
                return window.loadFile(htmlPath, { query: { theme: currentTheme } });
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
            // console.log('[MAIN] Window ready to show at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
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

        // Handle context menu for spell check suggestions
        window.webContents.on('context-menu', (_event, params) => {
            const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

            // Spell check suggestions
            if (params.misspelledWord) {
                if (params.dictionarySuggestions.length > 0) {
                    for (const suggestion of params.dictionarySuggestions) {
                        menuTemplate.push({
                            label: suggestion,
                            click: () => {
                                window.webContents.replaceMisspelling(suggestion);
                            }
                        });
                    }
                } else {
                    menuTemplate.push({
                        label: 'No suggestions',
                        enabled: false
                    });
                }

                menuTemplate.push({ type: 'separator' });

                menuTemplate.push({
                    label: 'Add to Dictionary',
                    click: () => {
                        window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
                    }
                });

                menuTemplate.push({ type: 'separator' });
            }

            // Standard edit operations when there's editable content
            if (params.isEditable) {
                menuTemplate.push(
                    { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
                    { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
                    { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }
                );

                if (params.selectionText) {
                    menuTemplate.push(
                        { type: 'separator' },
                        { label: 'Select All', role: 'selectAll' }
                    );
                }
            } else if (params.selectionText) {
                // Non-editable but has selection - just show copy
                menuTemplate.push(
                    { label: 'Copy', role: 'copy' }
                );
            }

            // Only show menu if we have items
            if (menuTemplate.length > 0) {
                const menu = Menu.buildFromTemplate(menuTemplate);
                menu.popup({ window });
            }
        });

        // When the window is ready, send initial data
        window.webContents.once('did-finish-load', () => {
            // console.log('[MAIN] did-finish-load at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');

            // DO NOT send theme-change here - the window already got the theme via getThemeSync()
            // Sending it again causes a flash as React re-applies the same theme
            // Only send theme-change when user actually changes theme from menu

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

        // console.log('[MAIN] Window created successfully at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
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

/**
 * Find window by workspace path (stable identifier)
 *
 * IMPORTANT: This is the preferred way to route to windows for async/deferred operations
 * (like notifications, sounds, etc.) because workspace paths are STABLE identifiers,
 * while Electron window IDs are TRANSIENT and change when windows close/reopen.
 *
 * Routing Strategy:
 * - Use workspacePath for: OS notifications, sound notifications, any deferred routing
 * - Use event.sender for: Immediate IPC responses during the same call
 * - Window IDs should only be used as a fallback when workspace path is unavailable
 *
 * @param workspacePath The absolute path to the workspace directory
 * @returns The BrowserWindow for that workspace, or null if not found
 */
export function findWindowByWorkspace(workspacePath: string): BrowserWindow | null {
    for (const [windowId, window] of windows) {
        const state = windowStates.get(windowId);
        if (state?.workspacePath === workspacePath) {
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

// IPC handler to check if a window is focused
safeHandle('window:is-focused', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? window.isFocused() : false;
});

// IPC handler to force focus a window (for testing)
safeHandle('window:force-focus', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.focus();
        return true;
    }
    return false;
});

// Handle close-window responses from renderer's custom dialog
safeOn('close-window-save', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
        const windowId = getWindowId(window);
        if (windowId !== null) {
            // Send save request
            window.webContents.send('save-before-close');
            // Wait for save to complete, then close
            setTimeout(() => {
                const currentState = windowStates.get(windowId);
                if (!currentState?.documentEdited && !window.isDestroyed()) {
                    window.destroy();
                }
            }, 100);
        }
    }
});

safeOn('close-window-discard', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
        window.destroy();
    }
});

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

import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme } from 'electron';
import { join, basename } from 'path';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'fs';
import * as chokidar from 'chokidar';
import Store from 'electron-store';

// Initialize electron store
const store = new Store();

// Window state interface
interface WindowState {
    mode: 'document' | 'project';
    filePath: string | null;
    projectPath: string | null;
    documentEdited: boolean;
}

// Recent items interface
interface RecentItem {
    path: string;
    name: string;
    timestamp: number;
}

// Session state interface
interface SessionWindow {
    mode: 'document' | 'project';
    filePath?: string;
    projectPath?: string;
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

interface SessionState {
    windows: SessionWindow[];
    lastUpdated: number;
}

// Maximum number of recent items to store
const MAX_RECENT_ITEMS = 10;

// Window management
const windows = new Map<number, BrowserWindow>();
const windowStates = new Map<number, WindowState>();

// File watchers management
const fileWatchers = new Map<number, chokidar.FSWatcher>();

let pendingFilePath: string | null = null;
let windowIdCounter = 0;

// Window position offset for cascading
const WINDOW_CASCADE_OFFSET = 25;

// Functions to manage recent items
function getRecentItems(type: 'projects' | 'documents'): RecentItem[] {
    const items = store.get(`recent.${type}`, []) as RecentItem[];
    // Sort by timestamp descending (most recent first)
    return items.sort((a, b) => b.timestamp - a.timestamp);
}

function addToRecentItems(type: 'projects' | 'documents', path: string, name: string) {
    const items = getRecentItems(type);

    // Remove if already exists
    const filtered = items.filter(item => item.path !== path);

    // Add to beginning
    filtered.unshift({
        path,
        name,
        timestamp: Date.now()
    });

    // Limit to MAX_RECENT_ITEMS
    const limited = filtered.slice(0, MAX_RECENT_ITEMS);

    // Save back to store
    store.set(`recent.${type}`, limited);

    // Update menu
    updateApplicationMenu();
}

function clearRecentItems(type: 'projects' | 'documents') {
    store.set(`recent.${type}`, []);
    updateApplicationMenu();
}

// Function to update the application menu (will be called after recent items change)
function updateApplicationMenu() {
    const menu = createApplicationMenu();
    Menu.setApplicationMenu(menu);
}

// Function to update native theme
function updateNativeTheme() {
    const currentTheme = store.get('theme', 'system') as string;

    if (currentTheme === 'system') {
        nativeTheme.themeSource = 'system';
    } else if (currentTheme === 'dark' || currentTheme === 'crystal-dark') {
        nativeTheme.themeSource = 'dark';
    } else {
        nativeTheme.themeSource = 'light';
    }
}

// Function to update window title bar colors based on theme
function updateWindowTitleBars() {
    const currentTheme = store.get('theme', 'system') as string;
    const systemDarkMode = nativeTheme.shouldUseDarkColors;
    const isDarkTheme = currentTheme === 'dark' ||
                      currentTheme === 'crystal-dark' ||
                      (currentTheme === 'system' && systemDarkMode);

    // Update native theme first
    updateNativeTheme();

    // Define title bar colors for each theme
    const titleBarColors = {
        dark: { color: '#1a1a1a', symbolColor: '#ffffff' },
        crystalDark: { color: '#1F2837', symbolColor: '#F3F4F6' },
        light: { color: '#ffffff', symbolColor: '#374151' }
    };

    // Select appropriate colors based on theme
    let titleBarColor = titleBarColors.light;
    let backgroundColor = '#ffffff';

    if (currentTheme === 'crystal-dark') {
        titleBarColor = titleBarColors.crystalDark;
        backgroundColor = '#1F2837';
    } else if (isDarkTheme) {
        titleBarColor = titleBarColors.dark;
        backgroundColor = '#1a1a1a';
    }

    // Update all windows
    BrowserWindow.getAllWindows().forEach(window => {
        // Update background color
        window.setBackgroundColor(backgroundColor);

        // Update title bar overlay on Windows/Linux
        if (process.platform !== 'darwin' && window.setTitleBarOverlay) {
            window.setTitleBarOverlay(titleBarColor);
        }
    });
}

// Save session state
function saveSessionState() {
    const sessionWindows: SessionWindow[] = [];

    for (const [windowId, window] of windows) {
        const state = windowStates.get(windowId);
        if (!state || window.isDestroyed()) continue;

        // Don't save untitled empty documents
        if (state.mode === 'document' && !state.filePath && !state.documentEdited) {
            continue;
        }

        const bounds = window.getBounds();
        const sessionWindow: SessionWindow = {
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

    store.set('session', sessionState);
    console.log('[SESSION] Saved session state:', sessionState);
}

// Restore session state
function restoreSessionState() {
    const sessionState = store.get('session') as SessionState | undefined;

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

// Create window list menu items
function createWindowListMenu(): any[] {
    const menuItems: any[] = [];
    const allWindows = BrowserWindow.getAllWindows();

    if (allWindows.length === 0) {
        return [];
    }

    // Sort windows by ID for consistent ordering
    const sortedWindows = allWindows.sort((a, b) => a.id - b.id);

    sortedWindows.forEach((window, index) => {
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

        // Add keyboard shortcut for first 9 windows
        const accelerator = index < 9 ? `CmdOrCtrl+${index + 1}` : undefined;

        menuItems.push({
            label: title,
            accelerator,
            type: 'checkbox',
            checked: window.isFocused(),
            click: () => {
                window.focus();
            }
        });
    });

    return menuItems;
}

// Create the recent submenu
function createRecentSubmenu(): any[] {
    const recentProjects = getRecentItems('projects');
    const recentDocuments = getRecentItems('documents');
    const submenu: any[] = [];

    // Recent Projects section
    if (recentProjects.length > 0) {
        submenu.push({ label: 'Recent Projects', enabled: false });
        recentProjects.forEach(project => {
            submenu.push({
                label: project.name,
                click: () => {
                    // Check if project exists
                    if (existsSync(project.path)) {
                        // Create a new window in project mode
                        createWindow(false, true, project.path);
                    } else {
                        // Remove from recent if doesn't exist
                        const items = getRecentItems('projects').filter(item => item.path !== project.path);
                        store.set('recent.projects', items);
                        updateApplicationMenu();
                        dialog.showErrorBox('Project Not Found', `The project "${project.name}" could not be found at:\n${project.path}`);
                    }
                }
            });
        });

        if (recentDocuments.length > 0) {
            submenu.push({ type: 'separator' });
        }
    }

    // Recent Documents section
    if (recentDocuments.length > 0) {
        submenu.push({ label: 'Recent Documents', enabled: false });
        recentDocuments.forEach(doc => {
            submenu.push({
                label: doc.name,
                click: () => {
                    // Check if file exists
                    if (existsSync(doc.path)) {
                        // Check if file is already open
                        const existingWindow = findWindowByFilePath(doc.path);
                        if (existingWindow) {
                            existingWindow.focus();
                        } else {
                            // Open in new window
                            const window = createWindow(true);
                            window.once('ready-to-show', () => {
                                loadFileIntoWindow(window, doc.path);
                            });
                        }
                    } else {
                        // Remove from recent if doesn't exist
                        const items = getRecentItems('documents').filter(item => item.path !== doc.path);
                        store.set('recent.documents', items);
                        updateApplicationMenu();
                        dialog.showErrorBox('File Not Found', `The file "${doc.name}" could not be found at:\n${doc.path}`);
                    }
                }
            });
        });
    }

    // Clear Recent options
    if (recentProjects.length > 0 || recentDocuments.length > 0) {
        submenu.push({ type: 'separator' });

        if (recentProjects.length > 0) {
            submenu.push({
                label: 'Clear Recent Projects',
                click: () => clearRecentItems('projects')
            });
        }

        if (recentDocuments.length > 0) {
            submenu.push({
                label: 'Clear Recent Documents',
                click: () => clearRecentItems('documents')
            });
        }
    }

    // If no recent items
    if (submenu.length === 0) {
        submenu.push({ label: 'No Recent Items', enabled: false });
    }

    return submenu;
}
let windowPositionOffset = 0;

// Untitled document counter
let untitledCounter = 0;

// Session save interval
let sessionSaveInterval: NodeJS.Timeout | null = null;

// File tree interface
interface FileTreeItem {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileTreeItem[];
}

// Get folder contents recursively
function getFolderContents(dirPath: string): FileTreeItem[] {
    try {
        const items = readdirSync(dirPath);
        const result: FileTreeItem[] = [];

        for (const item of items) {
            // Skip hidden files and common non-content directories
            if (item.startsWith('.') || item === 'node_modules' || item === 'dist' || item === 'build') {
                continue;
            }

            const fullPath = join(dirPath, item);
            const stats = statSync(fullPath);

            if (stats.isDirectory()) {
                result.push({
                    name: item,
                    path: fullPath,
                    type: 'directory',
                    children: getFolderContents(fullPath)
                });
            } else if (stats.isFile() && (item.endsWith('.md') || item.endsWith('.markdown'))) {
                result.push({
                    name: item,
                    path: fullPath,
                    type: 'file'
                });
            }
        }

        // Sort: directories first, then files, alphabetically
        return result.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    } catch (error) {
        console.error('Error reading folder contents:', error);
        return [];
    }
}

// Function to load file into window
function loadFileIntoWindow(window: BrowserWindow, filePath: string) {
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

// Find window by file path
function findWindowByFilePath(filePath: string): BrowserWindow | null {
    for (const [windowId, window] of windows) {
        const state = windowStates.get(windowId);
        if (state?.filePath === filePath) {
            return window;
        }
    }
    return null;
}

// Start watching a file for changes
function startFileWatcher(window: BrowserWindow, filePath: string) {
    const windowId = window.id;

    // Stop any existing watcher for this window
    stopFileWatcher(windowId);

    console.log('[FILE_WATCHER] Starting file watcher for:', filePath, 'window:', windowId);

    try {
        const watcher = chokidar.watch(filePath, {
            persistent: true,
            ignoreInitial: true,
            usePolling: true,  // Use polling instead of native fsevents
            interval: 1000,    // Check every second
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100
            }
        });

        // Add ready event to confirm watcher is active
        watcher.on('ready', () => {
            console.log('[FILE_WATCHER] Watcher ready for:', filePath);
        });

        watcher.on('add', (path) => {
            console.log('[FILE_WATCHER] File added:', path);
        });

        watcher.on('change', (path, stats) => {
            console.log('[FILE_WATCHER] File changed on disk:', path, 'stats:', stats);
            const state = windowStates.get(windowId);
            console.log('[FILE_WATCHER] Window state:', state);

            if (state?.documentEdited) {
                console.log('[FILE_WATCHER] Document has unsaved changes, showing dialog');
                // File has unsaved changes, ask user what to do
                const choice = dialog.showMessageBoxSync(window, {
                    type: 'question',
                    buttons: ['Keep My Changes', 'Load From Disk', 'Cancel'],
                    defaultId: 0,
                    cancelId: 2,
                    message: 'This file has been modified on disk. You have unsaved changes.\nWhat would you like to do?',
                    detail: `File: ${filePath}`
                });

                console.log('[FILE_WATCHER] User choice:', choice);

                if (choice === 1) {
                    // Load from disk
                    console.log('[FILE_WATCHER] Loading file from disk');
                    loadFileIntoWindow(window, filePath);
                }
                // choice === 0 or 2: keep current changes
            } else {
                // No unsaved changes, just reload
                console.log('[FILE_WATCHER] No unsaved changes, reloading file');
                loadFileIntoWindow(window, filePath);
            }
        });

        watcher.on('unlink', (path) => {
            console.log('[FILE_WATCHER] File deleted:', path);
            window.webContents.send('file-deleted', { filePath });
        });

        // Handle file rename/move
        watcher.on('error', (error) => {
            console.error('[FILE_WATCHER] File watcher error:', error);
        });

        watcher.on('raw', (event, path, details) => {
            console.log('[FILE_WATCHER] Raw event:', event, path, details);
        });

        fileWatchers.set(windowId, watcher);
        console.log('[FILE_WATCHER] Watcher stored for window:', windowId);

        // Log what files are being watched after a short delay
        setTimeout(() => {
            const watched = watcher.getWatched();
            console.log('[FILE_WATCHER] Currently watching:', watched);
        }, 1000);

    } catch (error) {
        console.error('[FILE_WATCHER] Failed to create watcher:', error);
    }
}

// Stop watching a file
function stopFileWatcher(windowId: number) {
    const watcher = fileWatchers.get(windowId);
    if (watcher) {
        console.log('[FILE_WATCHER] Stopping file watcher for window:', windowId);
        watcher.close();
        fileWatchers.delete(windowId);
    } else {
        console.log('[FILE_WATCHER] No watcher found for window:', windowId);
    }
}

// Get focused window or create new one
function getFocusedOrNewWindow(): BrowserWindow {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow && windows.has(focusedWindow.id)) {
        return focusedWindow;
    }
    return createWindow(false);
}

// Handle file opening from OS (file associations and dock drops)
// This needs to be registered early to catch files dropped on dock
app.on('open-file', (event, path) => {
    event.preventDefault();
    console.log('open-file event received:', path);

    if (app.isReady()) {
        // Check if file is already open
        const existingWindow = findWindowByFilePath(path);
        if (existingWindow) {
            existingWindow.focus();
        } else {
            // Open in new window
            const window = createWindow(true);
            window.once('ready-to-show', () => {
                loadFileIntoWindow(window, path);
            });
        }
    } else {
        // Store the file path to open after app is ready
        pendingFilePath = path;
    }
});


function createWindow(isOpeningFile: boolean = false, isProjectMode: boolean = false, projectPath: string | null = null, savedBounds?: { x: number; y: number; width: number; height: number }): BrowserWindow {
    const startTime = Date.now();
    try {
        console.log('[MAIN] Creating window at', new Date().toISOString());

        // Set up icon path based on platform
        let icon;
        try {
            if (process.platform === 'darwin') {
                // On macOS in dev, we need to use a PNG file, not the iconset
                const iconPath = join(__dirname, '../../../../assets/crystal-editor-iconset/icon.iconset/icon_512x512.png');
                console.log('Window icon path:', iconPath);
                if (existsSync(iconPath)) {
                    icon = nativeImage.createFromPath(iconPath);
                }
            } else if (process.platform === 'win32') {
                const iconPath = join(__dirname, '../../icon.ico');
                if (existsSync(iconPath)) {
                    icon = iconPath;
                }
            } else {
                // Linux
                const iconPath = join(__dirname, '../../icon.png');
                if (existsSync(iconPath)) {
                    icon = iconPath;
                }
            }
        } catch (error) {
            console.error('Error loading icon:', error);
        }

        console.log('[MAIN] About to create BrowserWindow at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');

        // Use saved bounds if provided, otherwise calculate window position for cascading effect
        let windowBounds: { width: number; height: number; x?: number; y?: number };

        if (savedBounds) {
            windowBounds = savedBounds;
        } else {
            const windowX = 100 + windowPositionOffset;
            const windowY = 100 + windowPositionOffset;
            windowBounds = {
                width: 1200,
                height: 800,
                x: windowX,
                y: windowY
            };

            // Increment offset for next window, reset after 10 windows to avoid going off screen
            windowPositionOffset += WINDOW_CASCADE_OFFSET;
            if (windowPositionOffset > WINDOW_CASCADE_OFFSET * 10) {
                windowPositionOffset = 0;
            }
        }

        // Get current theme for title bar styling
        const currentTheme = store.get('theme', 'system') as string;
        const systemDarkMode = nativeTheme.shouldUseDarkColors;
        const isDarkTheme = currentTheme === 'dark' ||
                          currentTheme === 'crystal-dark' ||
                          (currentTheme === 'system' && systemDarkMode);

        // Define title bar colors for each theme
        const titleBarColors = {
            dark: { color: '#1a1a1a', symbolColor: '#ffffff' },
            crystalDark: { color: '#1F2837', symbolColor: '#F3F4F6' },
            light: { color: '#ffffff', symbolColor: '#374151' }
        };

        // Select appropriate colors based on theme
        let titleBarColor = titleBarColors.light;
        if (currentTheme === 'crystal-dark') {
            titleBarColor = titleBarColors.crystalDark;
        } else if (isDarkTheme) {
            titleBarColor = titleBarColors.dark;
        }

        const window = new BrowserWindow({
            ...windowBounds,
            icon: icon,
            backgroundColor: isDarkTheme ? (currentTheme === 'crystal-dark' ? '#1F2837' : '#1a1a1a') : '#ffffff',
            // Use default title bar on macOS
            titleBarStyle: process.platform === 'darwin' ? undefined : 'hidden',
            titleBarOverlay: process.platform !== 'darwin' ? titleBarColor : false,
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        console.log('[MAIN] BrowserWindow created at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');

        // Add window to our tracking
        const windowId = window.id;
        windows.set(windowId, window);
        windowStates.set(windowId, {
            mode: isProjectMode ? 'project' : 'document',
            filePath: null,
            projectPath: projectPath,
            documentEdited: false
        });

        // Add event listeners to track loading
        window.webContents.on('did-start-loading', () => {
            console.log('[MAIN] did-start-loading at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
        });

        window.webContents.on('dom-ready', () => {
            console.log('[MAIN] dom-ready at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
        });

        // In development, load from vite dev server
        if (process.env.NODE_ENV === 'development') {
            console.log('[MAIN] Loading from dev server at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
            window.loadURL('http://localhost:5273');
        } else {
            // In production, load built files
            console.log('[MAIN] Loading from built files at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
            window.loadFile(join(__dirname, '../renderer/index.html'));
        }

        // Handle window close with unsaved changes
        window.on('close', (event) => {
            const state = windowStates.get(windowId);
            if (state?.documentEdited) {
                event.preventDefault();

                const choice = dialog.showMessageBoxSync(window, {
                    type: 'question',
                    buttons: ['Save', "Don't Save", 'Cancel'],
                    defaultId: 0,
                    cancelId: 2,
                    message: 'Do you want to save the changes you made?',
                    detail: 'Your changes will be lost if you close without saving.'
                });

                if (choice === 0) {
                    // Save
                    window.webContents.send('file-save');
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
                // If Cancel (choice === 2), do nothing
            }
        });

        window.on('close', (event) => {
            // Save session before the window is closed
            saveSessionState();
        });

        window.on('closed', () => {
            windows.delete(windowId);
            windowStates.delete(windowId);
            stopFileWatcher(windowId);
            // Update menu to reflect window closure
            updateApplicationMenu();
        });

        // Update menu when window gains/loses focus
        window.on('focus', () => {
            updateApplicationMenu();
        });

        window.on('blur', () => {
            updateApplicationMenu();
        });

        // If a file was requested to be opened before window was ready, open it now
        window.webContents.once('did-finish-load', () => {
            console.log('[MAIN] did-finish-load at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');

            // Send the current theme to the new window
            const theme = store.get('theme', 'system') as string;
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
            } else if (!pendingFilePath && !isOpeningFile) {
                // This is a new untitled document
                untitledCounter++;
                const untitledName = untitledCounter === 1 ? 'Untitled' : `Untitled ${untitledCounter}`;
                console.log('Sending new-untitled-document event:', untitledName);
                // Add a small delay to ensure renderer has set up listeners
                setTimeout(() => {
                    window.webContents.send('new-untitled-document', { untitledName });

                    // Clear represented filename for new documents
                    if (process.platform === 'darwin') {
                        window.setRepresentedFilename('');
                    }

                    // Mark as edited since it's a new document
                    // const state = windowStates.get(windowId);
                    // if (state) {
                    //     state.documentEdited = true;
                    // }
                }, 100);
            }
        });

        // Log any console messages from the renderer
        window.webContents.on('console-message', (event, level, message, line, sourceId) => {
            // Skip messages that are already from our console wrapper to avoid duplication
            if (message.includes('[renderer]') || message.includes('[main]')) {
                return;
            }

            // Map numeric levels to string names
            const levelNames = ['verbose', 'info', 'warning', 'error'];
            const levelName = levelNames[level] || 'unknown';

            // In development, write all console messages to debug log
            if (process.env.NODE_ENV !== 'production') {
                const timestamp = new Date().toISOString();
                const debugLogPath = join(app.getPath('userData'), 'stravu-editor-debug.log');
                const logMessage = `[${timestamp}] [${levelName.toUpperCase()}] [browser] ${message} (${sourceId}:${line})\n`;

                try {
                    appendFileSync(debugLogPath, logMessage);
                } catch (error) {
                    // Don't crash if we can't write to the log file
                    console.error('Failed to write browser console to debug log:', error);
                }

                // Also log to main console for immediate visibility
                console.log(`[Browser ${levelName}] ${message} (${sourceId}:${line})`);
            } else {
                // In production, only log warnings and errors
                if (level >= 2) { // 2 = warning, 3 = error
                    console.log(`[Browser ${levelName}] ${message} (${sourceId}:${line})`);
                }
            }
        });

        // Handle pending file after window is ready to show
        window.once('ready-to-show', () => {
            if (pendingFilePath) {
                loadFileIntoWindow(window, pendingFilePath);
                pendingFilePath = null;
            }
        });

        console.log('[MAIN] Window created successfully at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
        return window;
    } catch (error) {
        console.error('Error creating window:', error);
        throw error;
    }
}

// Set up console logging in development
if (process.env.NODE_ENV !== 'production') {
    const debugLogPath = join(app.getPath('userData'), 'stravu-editor-debug.log');

    // Clear log on startup
    try {
        writeFileSync(debugLogPath, `=== Stravu Editor Debug Log Started ${new Date().toISOString()} ===\n`);
        console.log('[MAIN] Debug logging enabled. Browser console logs will be written to:', debugLogPath);
    } catch (error) {
        console.error('Failed to initialize debug log:', error);
    }

    // Listen for console logs from renderer
    ipcMain.on('console-log', (_event, data) => {
        const logEntry = `[${data.timestamp}] [${data.level.toUpperCase()}] [${data.source}] ${data.message}\n`;
        try {
            appendFileSync(debugLogPath, logEntry);
        } catch (error) {
            console.error('Failed to write to debug log:', error);
        }
    });

    // Also capture main process logs
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info,
        debug: console.debug
    };

    const captureMainLog = (level: string, ...args: any[]) => {
        originalConsole[level as keyof typeof originalConsole](...args);

        const timestamp = new Date().toISOString();
        const message = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');

        const logEntry = `[${timestamp}] [${level.toUpperCase()}] [main] ${message}\n`;
        try {
            appendFileSync(debugLogPath, logEntry);
        } catch (error) {
            // Don't log this error to avoid infinite loop
        }
    };

    console.log = (...args) => captureMainLog('log', ...args);
    console.warn = (...args) => captureMainLog('warn', ...args);
    console.error = (...args) => captureMainLog('error', ...args);
    console.info = (...args) => captureMainLog('info', ...args);
    console.debug = (...args) => captureMainLog('debug', ...args);

    console.log('Debug logging enabled. Logs will be written to:', debugLogPath);
}

app.whenReady().then(() => {
    try {
        // Set dock icon for macOS
        if (process.platform === 'darwin' && app.dock) {
            const iconPath = join(__dirname, '../../../../assets/crystal-editor-iconset/icon.iconset/icon_512x512.png');
            console.log('Looking for icon at:', iconPath);
            if (existsSync(iconPath)) {
                const dockIcon = nativeImage.createFromPath(iconPath);
                app.dock.setIcon(dockIcon);
                console.log('Dock icon set successfully');
            } else {
                console.log('Icon file not found');
            }
        }

        // Try to restore session, otherwise create a new window
        const sessionRestored = restoreSessionState();

        if (!sessionRestored && !pendingFilePath) {
            // No session to restore and no file to open, create a new window
            createWindow(false);
        } else if (pendingFilePath) {
            // Handle pending file if we have one
            const window = createWindow(true);
            window.once('ready-to-show', () => {
                loadFileIntoWindow(window, pendingFilePath);
                pendingFilePath = null;
            });
        }

        createApplicationMenu();

        // Set initial native theme
        updateNativeTheme();

        // Save session periodically (every 30 seconds)
        sessionSaveInterval = setInterval(() => {
            saveSessionState();
        }, 30000);

        // Listen for system theme changes
        nativeTheme.on('updated', () => {
            const currentTheme = store.get('theme', 'system') as string;
            if (currentTheme === 'system') {
                // Update windows when system theme changes
                updateWindowTitleBars();
                // Send theme change to all windows
                BrowserWindow.getAllWindows().forEach(window => {
                    window.webContents.send('theme-change', 'system');
                });
            }
        });

        app.on('activate', () => {
            // On macOS, re-create window when dock icon is clicked
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });

    } catch (error) {
        console.error('Error during app initialization:', error);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
    // On macOS, keep the app running even when all windows are closed
    // This allows dropping files on the dock icon
});

// Save session state before quitting
app.on('before-quit', () => {
    console.log('[SESSION] App quitting, saving session state');

    // Clear the session save interval
    if (sessionSaveInterval) {
        clearInterval(sessionSaveInterval);
        sessionSaveInterval = null;
    }

    saveSessionState();
});


// Function to create application menu
function createApplicationMenu() {
    // Get current theme from store
    const currentTheme = store.get('theme', 'system') as string;

    const template: any[] = [
        {
            label: 'File',
            submenu: [
                { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
                { type: 'separator' },
                { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: async () => {
                    const result = await dialog.showOpenDialog({
                        properties: ['openFile'],
                        filters: [
                            { name: 'Markdown Files', extensions: ['md', 'markdown'] },
                            { name: 'Text Files', extensions: ['txt'] },
                            { name: 'All Files', extensions: ['*'] }
                        ]
                    });

                    if (!result.canceled && result.filePaths.length > 0) {
                        const filePath = result.filePaths[0];
                        // Check if file is already open
                        const existingWindow = findWindowByFilePath(filePath);
                        if (existingWindow) {
                            existingWindow.focus();
                        } else {
                            // Open in new window
                            const window = createWindow(true);
                            window.once('ready-to-show', () => {
                                loadFileIntoWindow(window, filePath);
                            });
                        }
                    }
                }},
                { label: 'Open Folder...', accelerator: 'CmdOrCtrl+Shift+O', click: async () => {
                    const result = await dialog.showOpenDialog({
                        properties: ['openDirectory']
                    });

                    if (!result.canceled && result.filePaths.length > 0) {
                        const projectPath = result.filePaths[0];
                        // Add to recent projects
                        addToRecentItems('projects', projectPath, basename(projectPath));
                        // Create a new window in project mode
                        createWindow(false, true, projectPath);
                    }
                }},
                {
                    label: 'Open Recent',
                    submenu: createRecentSubmenu()
                },
                { type: 'separator' },
                { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.webContents.send('file-save');
                }},
                { label: 'Save As', accelerator: 'CmdOrCtrl+Shift+S', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.webContents.send('file-save-as');
                }},
                { type: 'separator' },
                { label: 'Close', accelerator: 'CmdOrCtrl+W', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.close();
                }},
                { type: 'separator' },
                { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.webContents.toggleDevTools();
                }},
                { type: 'separator' },
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.webContents.reload();
                }},
                { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.webContents.reloadIgnoringCache();
                }},
                { type: 'separator' },
                { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) focused.webContents.setZoomFactor(1);
                }},
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) {
                        const currentZoom = focused.webContents.getZoomFactor();
                        focused.webContents.setZoomFactor(currentZoom + 0.1);
                    }
                }},
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => {
                    const focused = BrowserWindow.getFocusedWindow();
                    if (focused) {
                        const currentZoom = focused.webContents.getZoomFactor();
                        focused.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
                    }
                }}
            ]
        },
        {
            label: 'Window',
            submenu: [
                {
                    label: 'Theme',
                    submenu: [
                        {
                            label: 'Light',
                            type: 'radio',
                            checked: currentTheme === 'light',
                            click: () => {
                                store.set('theme', 'light');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'light');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        },
                        {
                            label: 'Dark',
                            type: 'radio',
                            checked: currentTheme === 'dark',
                            click: () => {
                                store.set('theme', 'dark');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'dark');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        },
                        {
                            label: 'Crystal Dark',
                            type: 'radio',
                            checked: currentTheme === 'crystal-dark',
                            click: () => {
                                store.set('theme', 'crystal-dark');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'crystal-dark');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        },
                        {
                            label: 'System',
                            type: 'radio',
                            checked: currentTheme === 'system',
                            click: () => {
                                store.set('theme', 'system');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'system');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        }
                    ]
                },
                { type: 'separator' },
                { label: 'Minimize', role: 'minimize' },
                { label: 'Close', role: 'close' },
                { type: 'separator' },
                ...createWindowListMenu()
            ]
        }
    ];

// Add app menu on macOS
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.getName(),
            submenu: [
                {
                    label: 'About Stravu Editor',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('show-about');
                        }
                    }
                },
                { type: 'separator' },
                { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', enabled: false },
                { type: 'separator' },
                { label: 'Services', submenu: [] },
                { type: 'separator' },
                { label: 'Hide ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
                { label: 'Hide Others', accelerator: 'Command+Shift+H', role: 'hideothers' },
                { label: 'Show All', role: 'unhide' },
                { type: 'separator' },
                { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() }
            ]
        });
    } else {
        // Windows and Linux
        template.push({
            label: 'Help',
            submenu: [
                {
                    label: 'About Stravu Editor',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('show-about');
                        }
                    }
                }
            ]
        });
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC handlers for file operations
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

ipcMain.handle('save-file', async (event, content: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    const windowId = window.id;
    const state = windowStates.get(windowId);
    const filePath = state?.filePath;

    console.log('[SAVE] save-file handler called, filePath:', filePath, 'window:', windowId);
    try {
        if (!filePath) {
            console.log('[SAVE] No current file path for this window');
            // No file is currently open - the renderer should handle this
            // by calling save-file-as instead
            return null;
        }

        // Temporarily pause the file watcher to avoid triggering on our own save
        const watcher = fileWatchers.get(windowId);
        if (watcher) {
            console.log('[SAVE] Pausing file watcher during save');
            watcher.unwatch(filePath);
        }

        console.log('[SAVE] Writing to file:', filePath);
        writeFileSync(filePath, content, 'utf-8');
        if (state) {
            state.documentEdited = false; // Reset dirty state after save
        }

        // Resume watching after a short delay
        if (watcher) {
            setTimeout(() => {
                console.log('[SAVE] Resuming file watcher after save');
                watcher.add(filePath);
            }, 500);
        }
        return { success: true, filePath };
    } catch (error) {
        console.error('Error saving file:', error);
        return null;
    }
});

// IPC handler to update current file path from renderer (for drag-drop)
ipcMain.on('set-current-file', (event, filePath: string | null) => {
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

        // Update menu to reflect new file
        updateApplicationMenu();

        // Start watching the new file
        if (filePath) {
            console.log('[SET_FILE] Starting watcher for new file:', filePath);
            startFileWatcher(window, filePath);
        }
    }
    console.log('[SET_FILE] Current file path updated from renderer:', filePath);
});

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
            if (state) {
                state.filePath = filePath;
                state.documentEdited = false;
            }
            writeFileSync(filePath, content, 'utf-8');

            // Set represented filename for macOS
            if (process.platform === 'darwin') {
                window.setRepresentedFilename(filePath);
            }

            return { success: true, filePath };
        }

        return null;
    } catch (error) {
        console.error('Error saving file as:', error);
        return null;
    }
});

// IPC handlers for window operations
ipcMain.on('set-document-edited', (event, edited: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;

    const windowId = window.id;
    const state = windowStates.get(windowId);
    if (state) {
        state.documentEdited = edited;
    }
    window.setDocumentEdited(edited);

    // Update menu to reflect new window state
    updateApplicationMenu();
});

ipcMain.on('set-title', (event, title: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.setTitle(title);
        // Update menu to reflect new window title
        updateApplicationMenu();
    }
});


// IPC handler for getting folder contents
ipcMain.handle('get-folder-contents', (event, dirPath: string) => {
    return getFolderContents(dirPath);
});


// IPC handler for switching files within a project
ipcMain.handle('switch-project-file', async (event, filePath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;

    try {
        const content = readFileSync(filePath, 'utf-8');
        const windowId = window.id;
        const state = windowStates.get(windowId);

        if (state) {
            // Stop watching the old file
            if (state.filePath && state.filePath !== filePath) {
                stopFileWatcher(windowId);
            }

            state.filePath = filePath;
            state.documentEdited = false;

            // Start watching the new file
            startFileWatcher(window, filePath);
        }

        // Set represented filename for macOS
        if (process.platform === 'darwin') {
            window.setRepresentedFilename(filePath);
        }

        return { filePath, content };
    } catch (error) {
        console.error('Error switching project file:', error);
        return null;
    }
});

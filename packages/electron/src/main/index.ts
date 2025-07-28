import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

// Window management
const windows = new Map<number, BrowserWindow>();
const windowStates = new Map<number, {
    filePath: string | null;
    documentEdited: boolean;
}>();

let pendingFilePath: string | null = null;
let windowIdCounter = 0;

// Window position offset for cascading
const WINDOW_CASCADE_OFFSET = 25;
let windowPositionOffset = 0;

// Untitled document counter
let untitledCounter = 0;

// Function to load file into window
function loadFileIntoWindow(window: BrowserWindow, filePath: string) {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const windowId = window.id;
        const state = windowStates.get(windowId);
        if (state) {
            state.filePath = filePath;
            state.documentEdited = false;
        }
        console.log('Loading file into window:', filePath);
        window.webContents.send('file-opened-from-os', { filePath, content });
    } catch (error) {
        console.error('Error loading file from OS:', error);
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


function createWindow(isOpeningFile: boolean = false): BrowserWindow {
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
        
        // Calculate window position for cascading effect
        const windowX = 100 + windowPositionOffset;
        const windowY = 100 + windowPositionOffset;
        
        const window = new BrowserWindow({
            width: 1200,
            height: 800,
            x: windowX,
            y: windowY,
            icon: icon,
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        
        // Increment offset for next window, reset after 10 windows to avoid going off screen
        windowPositionOffset += WINDOW_CASCADE_OFFSET;
        if (windowPositionOffset > WINDOW_CASCADE_OFFSET * 10) {
            windowPositionOffset = 0;
        }
        console.log('[MAIN] BrowserWindow created at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');

        // Add window to our tracking
        const windowId = window.id;
        windows.set(windowId, window);
        windowStates.set(windowId, {
            filePath: null,
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

        window.on('closed', () => {
            windows.delete(windowId);
            windowStates.delete(windowId);
        });

        // If a file was requested to be opened before window was ready, open it now
        window.webContents.once('did-finish-load', () => {
            console.log('[MAIN] did-finish-load at', new Date().toISOString(), 'elapsed:', Date.now() - startTime, 'ms');
            // Don't send untitled document event if we're already handling a file
            if (!pendingFilePath && !isOpeningFile) {
                // This is a new untitled document
                untitledCounter++;
                const untitledName = untitledCounter === 1 ? 'Untitled' : `Untitled ${untitledCounter}`;
                console.log('Sending new-untitled-document event:', untitledName);
                // Add a small delay to ensure renderer has set up listeners
                setTimeout(() => {
                    window.webContents.send('new-untitled-document', { untitledName });
                    // Mark as edited since it's a new document
                    const state = windowStates.get(windowId);
                    if (state) {
                        state.documentEdited = true;
                    }
                }, 100);
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

        // Create window, marking it as opening a file if we have a pending file
        createWindow(!!pendingFilePath);
        createApplicationMenu();

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


// Function to create application menu
function createApplicationMenu() {
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
                        dialog.showMessageBox(focused || undefined, {
                            type: 'info',
                            title: 'About Stravu Editor',
                            message: 'Stravu Editor',
                            detail: `Version 0.33.1\n\nA powerful rich text editor made with ❤️ by Stravu\n\nBuilt with Lexical - Meta's extensible text editor framework\n\nCredits:\n• Lexical Framework by Meta\n• Based on Lexical Playground\n• Icons and design by Stravu\n\n© 2024 Stravu. All rights reserved.`,
                            buttons: ['OK'],
                            icon: process.platform === 'darwin'
                                ? nativeImage.createFromPath(join(__dirname, '../../../../assets/crystal-editor-iconset/icon.iconset/icon_512x512.png'))
                                : undefined
                        });
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
                        dialog.showMessageBox(focused || undefined, {
                            type: 'info',
                            title: 'About Stravu Editor',
                            message: 'Stravu Editor',
                            detail: `Version 0.33.1\n\nA powerful rich text editor made with ❤️ by Stravu\n\nBuilt with Lexical - Meta's extensible text editor framework\n\nCredits:\n• Lexical Framework by Meta\n• Based on Lexical Playground\n• Icons and design by Stravu\n\n© 2024 Stravu. All rights reserved.`,
                            buttons: ['OK']
                        });
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
    
    console.log('save-file handler called, filePath:', filePath);
    try {
        if (!filePath) {
            console.log('No current file path for this window');
            // No file is currently open - the renderer should handle this
            // by calling save-file-as instead
            return null;
        }

        console.log('Writing to file:', filePath);
        writeFileSync(filePath, content, 'utf-8');
        if (state) {
            state.documentEdited = false; // Reset dirty state after save
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
        state.filePath = filePath;
    }
    console.log('Current file path updated from renderer:', filePath);
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
});

ipcMain.on('set-title', (event, title: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
        window.setTitle(title);
    }
});

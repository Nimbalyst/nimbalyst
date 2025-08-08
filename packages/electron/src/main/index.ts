import { app, BrowserWindow, nativeTheme, nativeImage, ipcMain } from 'electron';
import { join } from 'path';
import { existsSync, writeFileSync, appendFileSync } from 'fs';
import { createWindow, windows, windowStates, findWindowByFilePath } from './window/WindowManager';
import { loadFileIntoWindow } from './file/FileOperations';
import { createApplicationMenu, updateApplicationMenu } from './menu/ApplicationMenu';
import { updateNativeTheme, updateWindowTitleBars } from './theme/ThemeManager';
import { saveSessionState, restoreSessionState } from './session/SessionState';
import { registerFileHandlers } from './ipc/FileHandlers';
import { registerProjectHandlers } from './ipc/ProjectHandlers';
import { registerSettingsHandlers } from './ipc/SettingsHandlers';
import { registerWindowHandlers } from './ipc/WindowHandlers';
import { registerHistoryHandlers } from './ipc/HistoryHandlers';
import { registerSessionHandlers } from './ipc/SessionHandlers';
import { getTheme } from './utils/store';

// Track pending file to open
let pendingFilePath: string | null = null;

// Session save interval
let sessionSaveInterval: NodeJS.Timeout | null = null;

// Initialize debug logging in development
function initializeDebugLogging() {
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
}

// Handle file open from OS (macOS)
app.on('open-file', (event, path) => {
    event.preventDefault();
    console.log('[MAIN] open-file event received:', path);
    
    if (app.isReady()) {
        // Check if file is already open in a window
        const existingWindow = findWindowByFilePath(path);
        if (existingWindow) {
            existingWindow.focus();
            return;
        }
        
        // Open in new window
        const window = createWindow(true);
        window.once('ready-to-show', () => {
            loadFileIntoWindow(window, path);
        });
    } else {
        // Store the file path to open after app is ready
        pendingFilePath = path;
    }
});

// App ready handler
app.whenReady().then(async () => {
    console.log('[MAIN] App ready');
    
    // Initialize debug logging
    initializeDebugLogging();
    
    // Set dock icon for macOS
    if (process.platform === 'darwin' && app.dock) {
        const iconPath = join(__dirname, '../../icon.png');
        console.log('Looking for icon at:', iconPath);
        if (existsSync(iconPath)) {
            const dockIcon = nativeImage.createFromPath(iconPath);
            app.dock.setIcon(dockIcon);
            console.log('Dock icon set successfully');
        } else {
            console.log('Icon file not found');
        }
    }
    
    // Register all IPC handlers
    registerFileHandlers();
    registerProjectHandlers();
    registerSettingsHandlers();
    registerWindowHandlers();
    await registerHistoryHandlers();
    await registerSessionHandlers();
    
    // Try to restore session, otherwise create a new window
    const sessionRestored = restoreSessionState();
    
    if (!sessionRestored && !pendingFilePath) {
        // No session to restore and no file to open, create a new window
        createWindow(false);
    } else if (pendingFilePath) {
        // Handle pending file if we have one
        const window = createWindow(true);
        window.once('ready-to-show', () => {
            loadFileIntoWindow(window, pendingFilePath!);
            pendingFilePath = null;
        });
    }
    
    // Create application menu
    createApplicationMenu();
    
    // Set initial native theme
    updateNativeTheme();
    
    // Update menu periodically to catch any state changes
    setInterval(() => {
        updateApplicationMenu();
    }, 1000);
    
    // Save session periodically (every 30 seconds)
    sessionSaveInterval = setInterval(() => {
        saveSessionState();
    }, 30000);
    
    // Listen for system theme changes
    nativeTheme.on('updated', () => {
        const currentTheme = getTheme();
        if (currentTheme === 'system') {
            // Update windows when system theme changes
            updateWindowTitleBars();
            // Send theme change to all windows
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('theme-change', 'system');
            });
        }
    });
});

// Activate handler (macOS)
app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Before quit handler
app.on('before-quit', () => {
    console.log('[SESSION] App quitting, saving session state');
    
    // Clear the session save interval
    if (sessionSaveInterval) {
        clearInterval(sessionSaveInterval);
        sessionSaveInterval = null;
    }
    
    // Save session state
    saveSessionState();
});

// Window all closed handler
app.on('window-all-closed', () => {
    console.log('[MAIN] All windows closed');
    // On macOS, keep app running when all windows are closed
    // This allows dropping files on the dock icon
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
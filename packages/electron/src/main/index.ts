import { app, BrowserWindow, nativeTheme, nativeImage, ipcMain } from 'electron';
import { join } from 'path';
import { existsSync, writeFileSync, appendFileSync } from 'fs';
import { createWindow, windows, windowStates, findWindowByFilePath } from './window/WindowManager';
import { loadFileIntoWindow } from './file/FileOperations';
import { createApplicationMenu, updateApplicationMenu } from './menu/ApplicationMenu';
import { updateNativeTheme, updateWindowTitleBars } from './theme/ThemeManager';
import { saveSessionState, restoreSessionState } from './session/SessionState';
import { createProjectManagerWindow, setupProjectManagerHandlers } from './window/ProjectManagerWindow';
import { registerSessionManagerHandlers } from './window/SessionManagerWindow';
import { registerFileHandlers } from './ipc/FileHandlers';
import { registerProjectHandlers } from './ipc/ProjectHandlers';
import { registerSettingsHandlers } from './ipc/SettingsHandlers';
import { registerWindowHandlers } from './ipc/WindowHandlers';
import { registerHistoryHandlers } from './ipc/HistoryHandlers';
import { registerSessionHandlers } from './ipc/SessionHandlers';
import { registerPreferencesHandlers } from './ipc/PreferencesHandlers';
import { getTheme } from './utils/store';
import { AIService } from './services/ai/AIService';
import { startMcpHttpServer, updateDocumentState } from './mcp/httpServer';
import { logger } from './utils/logger';

// Track pending file to open
let pendingFilePath: string | null = null;
// Track pending project to open
let pendingProjectPath: string | null = null;

// Session save interval
let sessionSaveInterval: NodeJS.Timeout | null = null;

// AI service instance
let aiService: AIService | null = null;

// Initialize debug logging in development
function initializeDebugLogging() {
    if (process.env.NODE_ENV !== 'production') {
        const debugLogPath = join(app.getPath('userData'), 'stravu-editor-debug.log');
        
        // Clear log on startup
        try {
            writeFileSync(debugLogPath, `=== Stravu Editor Debug Log Started ${new Date().toISOString()} ===\n`);
            logger.main.info(`Debug logging enabled. Browser console logs will be written to: ${debugLogPath}`);
        } catch (error) {
            logger.main.error('Failed to initialize debug log:', error);
        }

        // Listen for console logs from renderer
        ipcMain.on('console-log', (_event, data) => {
            const logEntry = `[${data.timestamp}] [${data.level.toUpperCase()}] [${data.source}] ${data.message}\n`;
            try {
                appendFileSync(debugLogPath, logEntry);
            } catch (error) {
                logger.main.error('Failed to write to debug log:', error);
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
            // Call original console method first with try-catch
            try {
                originalConsole[level as keyof typeof originalConsole](...args);
            } catch (error) {
                // Ignore console errors (EPIPE, etc)
            }

            const timestamp = new Date().toISOString();
            const message = args.map(arg => {
                try {
                    return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
                } catch (e) {
                    return '[Circular or unstringifiable object]';
                }
            }).join(' ');

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

        logger.main.info(`Debug logging enabled. Logs will be written to: ${debugLogPath}`);
    }
}

// Handle file open from OS (macOS)
app.on('open-file', (event, path) => {
    event.preventDefault();
    logger.main.info(`open-file event received: ${path}`);
    
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

// Parse command line arguments
function parseCommandLineArgs() {
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--project' && i + 1 < args.length) {
            pendingProjectPath = args[i + 1];
            logger.main.info(`Project path from CLI: ${pendingProjectPath}`);
        }
    }
}


// App ready handler
app.whenReady().then(async () => {
    logger.main.info('App ready');
    
    // Parse command line arguments
    parseCommandLineArgs();
    
    // Initialize debug logging
    initializeDebugLogging();
    
    // Set dock icon for macOS
    if (process.platform === 'darwin' && app.dock) {
        const iconPath = join(__dirname, '../../resources/icon.png');
        if (existsSync(iconPath)) {
            const dockIcon = nativeImage.createFromPath(iconPath);
            app.dock.setIcon(dockIcon);
            logger.main.info('Dock icon set successfully from resources');
        } else {
            logger.main.warn(`icon not found at: ${iconPath}`);
        }
    }
    
    // Register all IPC handlers
    registerFileHandlers();
    registerProjectHandlers();
    registerSettingsHandlers();
    registerWindowHandlers();
    await registerHistoryHandlers();
    await registerSessionHandlers();
    registerPreferencesHandlers();
    registerSessionManagerHandlers();
    setupProjectManagerHandlers();
    
    // Initialize AI service
    aiService = new AIService();
    
    // Start MCP SSE server
    try {
        await startMcpHttpServer(3456);
        logger.mcp.info('MCP SSE server started on port 3456');
    } catch (error) {
            logger.mcp.error('Failed to start MCP SSE server:', error);
    }
    
    // Set up IPC handler to update document state for MCP
    ipcMain.on('mcp:updateDocumentState', (event, state) => {
        updateDocumentState(state);
    });
    
    // Try to restore session, otherwise show Project Manager
    const sessionRestored = restoreSessionState();
    
    if (pendingProjectPath) {
        // Handle project path from CLI
        const window = createWindow(true);
        window.once('ready-to-show', () => {
            // Send project open event to renderer
            window.webContents.send('open-project-from-cli', pendingProjectPath);
            pendingProjectPath = null;
        });
    } else if (!sessionRestored && !pendingFilePath) {
        // No session to restore and no file to open, show Project Manager
        createProjectManagerWindow();
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
    logger.session.info('App quitting, saving session state');
    
    // Clear the session save interval
    if (sessionSaveInterval) {
        clearInterval(sessionSaveInterval);
        sessionSaveInterval = null;
    }
    
    // Clean up AI service
    if (aiService) {
        aiService.destroy();
        aiService = null;
    }
    
    // Save session state
    saveSessionState();
});

// Window all closed handler
app.on('window-all-closed', () => {
    logger.main.info('All windows closed');
    // On macOS, keep app running when all windows are closed
    // and show the Project Manager
    if (process.platform === 'darwin') {
        // Show Project Manager when all windows are closed on macOS
        createProjectManagerWindow();
    } else {
        // On other platforms, quit when all windows are closed
        app.quit();
    }
});
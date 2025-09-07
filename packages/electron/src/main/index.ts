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
import { getTheme } from './utils/store';
import { AIService } from './services/ai/AIService';
import { startMcpHttpServer, updateDocumentState, cleanupMcpServer, shutdownHttpServer } from './mcp/httpServer';
import { logger } from './utils/logger';
import { startPerformanceMonitoring } from './utils/performanceMonitor';
import { setupForceQuit, cancelForceQuit } from './utils/forceQuit';

// Track pending file to open
let pendingFilePath: string | null = null;
// Track pending project to open
let pendingProjectPath: string | null = null;

// Session save interval
let sessionSaveInterval: NodeJS.Timeout | null = null;
let menuUpdateInterval: NodeJS.Timeout | null = null;
let memoryMonitorInterval: NodeJS.Timeout | null = null;

// Track if app is quitting
let isAppQuitting = false;

// Track app start time for memory monitoring
const appStartTime = Date.now();

// AI service instance
let aiService: AIService | null = null;
let mcpHttpServer: any = null;

// Initialize logging
function initializeLogging() {
    // electron-log handles main process logging
    logger.main.info('Application logging initialized');
    
    // Always capture error logs for debugging
    const debugLogPath = join(app.getPath('userData'), 'stravu-editor-debug.log');
    
    // Initialize or append to log
    try {
        const timestamp = new Date().toISOString();
        if (process.env.NODE_ENV !== 'production') {
            writeFileSync(debugLogPath, `=== Debug Log Started ${timestamp} ===\n`);
        } else {
            appendFileSync(debugLogPath, `\n=== App Started ${timestamp} ===\n`);
        }
    } catch (error) {
        logger.main.error('Failed to initialize debug log:', error);
    }

    // Listen for console logs from renderer (always capture errors)
    ipcMain.on('console-log', (_event, data) => {
        // In production, only log errors and warnings
        if (process.env.NODE_ENV === 'production' && !['error', 'warn'].includes(data.level)) {
            return;
        }
        
        const logEntry = `[${data.timestamp}] [${data.level.toUpperCase()}] [${data.source}] ${data.message}\n`;
        try {
            appendFileSync(debugLogPath, logEntry);
        } catch (error) {
            // Ignore write errors
        }
    });
    
    logger.main.info(`Debug logs will be written to: ${debugLogPath}`);
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
    
    // Initialize logging
    initializeLogging();
    
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
    registerSessionManagerHandlers();
    setupProjectManagerHandlers();
    
    // Initialize AI service
    aiService = new AIService();
    
    // Start MCP SSE server
    try {
        const result = await startMcpHttpServer(3456);
        mcpHttpServer = result.httpServer;
        logger.mcp.info('MCP SSE server started on port', result.port);
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
    
    // Start performance monitoring
    startPerformanceMonitoring();
    
    // Remove periodic menu updates - menus should update on events only
    // This was causing high CPU usage by updating every second
    // menuUpdateInterval = setInterval(() => {
    //     if (!isAppQuitting && BrowserWindow.getAllWindows().length > 0) {
    //         updateApplicationMenu();
    //     }
    // }, 1000);
    
    // Save session periodically (every 30 seconds)
    sessionSaveInterval = setInterval(() => {
        // Only save if app is not quitting
        if (!isAppQuitting) {
            saveSessionState();
        }
    }, 30000);
    
    // Monitor memory usage and perform cleanup for long-running sessions
    memoryMonitorInterval = setInterval(() => {
        if (!isAppQuitting) {
            const memUsage = process.memoryUsage();
            const uptime = Date.now() - appStartTime;
            
            // Log memory usage every hour
            if (uptime % 3600000 < 60000) {
                console.log('[Memory] Usage:', {
                    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
                    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
                    uptime: `${Math.round(uptime / 1000 / 60)} minutes`
                });
            }
            
            // If memory usage is high (>1GB heap), trigger garbage collection
            if (memUsage.heapUsed > 1024 * 1024 * 1024) {
                if (global.gc) {
                    console.log('[Memory] High heap usage detected, running garbage collection');
                    global.gc();
                }
                
                // Also clear webContents caches for all windows
                BrowserWindow.getAllWindows().forEach(window => {
                    if (!window.isDestroyed()) {
                        window.webContents.session.clearCache();
                    }
                });
            }
            
            // After 12 hours of runtime, suggest restart
            if (uptime > 12 * 60 * 60 * 1000) {
                console.warn('[Memory] App has been running for over 12 hours, consider restarting');
            }
        }
    }, 60000); // Check every minute
    
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
app.on('before-quit', async (event) => {
    console.log('[QUIT] before-quit event triggered');
    
    // If we're already quitting, don't prevent default to avoid infinite loop
    if (isAppQuitting) {
        console.log('[QUIT] Already quitting, allowing default behavior');
        return;
    }
    
    // Prevent default to do async cleanup
    event.preventDefault();
    
    // Mark app as quitting to prevent interval operations
    isAppQuitting = true;
    
    // Setup force quit timer (2 seconds)
    setupForceQuit(2000);
    
    const fs = require('fs');
    const debugLog = require('path').join(app.getPath('userData'), 'stravu-editor-debug.log');
    
    try {
        fs.appendFileSync(debugLog, `\n[QUIT] before-quit event at ${new Date().toISOString()}\n`);
    } catch (e) {}
    
    try {
        logger.session.info('App quitting, saving session state');
        
        // Clear ALL intervals
        if (sessionSaveInterval) {
            clearInterval(sessionSaveInterval);
            sessionSaveInterval = null;
        }
        if (menuUpdateInterval) {
            clearInterval(menuUpdateInterval);
            menuUpdateInterval = null;
        }
        if (memoryMonitorInterval) {
            clearInterval(memoryMonitorInterval);
            memoryMonitorInterval = null;
        }
    } catch (error) {
        console.error('Error in before-quit handler:', error);
        fs.appendFileSync(debugLog, `[QUIT] Error in session save: ${error}\n`);
    }
    
    try {
        // Clean up AI service
        if (aiService) {
            fs.appendFileSync(debugLog, '[QUIT] Destroying AI service\n');
            aiService.destroy();
            aiService = null;
        }
    } catch (error) {
        console.error('[QUIT] Error destroying AI service:', error);
        fs.appendFileSync(debugLog, `[QUIT] Error destroying AI service: ${error}\n`);
    }
    
    try {
        // Shutdown MCP HTTP server properly
        fs.appendFileSync(debugLog, '[QUIT] Shutting down MCP HTTP server\n');
        await shutdownHttpServer();
        fs.appendFileSync(debugLog, '[QUIT] MCP HTTP server shutdown complete\n');
        mcpHttpServer = null;
    } catch (error) {
        console.error('[QUIT] Error closing MCP server:', error);
        fs.appendFileSync(debugLog, `[QUIT] Error closing MCP server: ${error}\n`);
    }
    
    try {
        // Save session state
        fs.appendFileSync(debugLog, '[QUIT] Saving session state\n');
        saveSessionState();
        fs.appendFileSync(debugLog, '[QUIT] Session state saved\n');
    } catch (error) {
        console.error('[QUIT] Error saving session state:', error);
        fs.appendFileSync(debugLog, `[QUIT] Error saving session: ${error}\n`);
    }
    
    // After all cleanup, quit the app
    fs.appendFileSync(debugLog, '[QUIT] All cleanup complete, quitting app\n');
    
    // Cancel force quit if we're about to quit normally
    cancelForceQuit();
    
    // Now quit
    app.quit();
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
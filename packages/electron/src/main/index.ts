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
import { startMcpHttpServer, updateDocumentState, cleanupMcpServer } from './mcp/httpServer';
import { logger } from './utils/logger';

// Track pending file to open
let pendingFilePath: string | null = null;
// Track pending project to open
let pendingProjectPath: string | null = null;

// Session save interval
let sessionSaveInterval: NodeJS.Timeout | null = null;
let menuUpdateInterval: NodeJS.Timeout | null = null;

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
    
    // Update menu periodically to catch any state changes
    menuUpdateInterval = setInterval(() => {
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
app.on('before-quit', (event) => {
    console.log('[QUIT] before-quit event triggered');
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
        // Clean up MCP transports first
        fs.appendFileSync(debugLog, '[QUIT] Cleaning up MCP transports\n');
        cleanupMcpServer();
        
        // Close MCP HTTP server
        if (mcpHttpServer) {
            fs.appendFileSync(debugLog, '[QUIT] Closing MCP HTTP server\n');
            // Force close all connections
            mcpHttpServer.close((err?: Error) => {
                if (err) {
                    fs.appendFileSync(debugLog, `[QUIT] Error in server close callback: ${err}\n`);
                } else {
                    fs.appendFileSync(debugLog, '[QUIT] MCP server closed successfully\n');
                }
            });
            // Also try to destroy all connections immediately
            if (typeof mcpHttpServer.closeAllConnections === 'function') {
                mcpHttpServer.closeAllConnections();
                fs.appendFileSync(debugLog, '[QUIT] Called closeAllConnections\n');
            }
            mcpHttpServer = null;
        }
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
    
    // List all active handles to see what's keeping us alive
    fs.appendFileSync(debugLog, '[QUIT] Checking what is keeping process alive...\n');
    
    // Don't try immediate exit - let cleanup happen first
    // The timer will force quit if needed
    fs.appendFileSync(debugLog, '[QUIT] Cleanup initiated, timer will force quit in 3s if needed\n');
    
    // Also try process.nextTick
    process.nextTick(() => {
        fs.appendFileSync(debugLog, '[QUIT] nextTick fired\n');
    });
    
    // Force quit after 3 seconds if still hanging
    fs.appendFileSync(debugLog, '[QUIT] Setting up force quit timer for 3 seconds...\n');
    const forceQuitTimer = setTimeout(() => {
        fs.appendFileSync(debugLog, '[QUIT] === FORCE QUIT TIMER FIRED ===\n');
        try {
            fs.appendFileSync(debugLog, '[QUIT] Force quitting after 3 second timeout\n');
            
            // Try to force close the MCP server again
            if (mcpHttpServer) {
                fs.appendFileSync(debugLog, '[QUIT] MCP server still exists, trying to destroy it\n');
                try {
                    mcpHttpServer.unref?.();
                    mcpHttpServer.close();
                } catch (e) {
                    fs.appendFileSync(debugLog, `[QUIT] Failed to destroy MCP server: ${e}\n`);
                }
            }
            
            // Log what's keeping the process alive
            const activeHandles = (process as any)._getActiveHandles?.();
            const activeRequests = (process as any)._getActiveRequests?.();
            
            if (activeHandles) {
                fs.appendFileSync(debugLog, `[QUIT] Active handles: ${activeHandles.length}\n`);
                activeHandles.forEach((handle: any, i: number) => {
                    fs.appendFileSync(debugLog, `[QUIT]   Handle ${i}: ${handle.constructor.name}\n`);
                });
            }
            
            if (activeRequests) {
                fs.appendFileSync(debugLog, `[QUIT] Active requests: ${activeRequests.length}\n`);
                activeRequests.forEach((req: any, i: number) => {
                    fs.appendFileSync(debugLog, `[QUIT]   Request ${i}: ${req.constructor.name}\n`);
                });
            }
            
            // List all windows
            const windows = BrowserWindow.getAllWindows();
            fs.appendFileSync(debugLog, `[QUIT] Open windows: ${windows.length}\n`);
            windows.forEach((win, i) => {
                fs.appendFileSync(debugLog, `[QUIT]   Window ${i}: ${win.getTitle()} (destroyed: ${win.isDestroyed()})\n`);
                try {
                    win.destroy();
                    fs.appendFileSync(debugLog, `[QUIT]   Destroyed window ${i}\n`);
                } catch (e) {
                    fs.appendFileSync(debugLog, `[QUIT]   Failed to destroy window ${i}: ${e}\n`);
                }
            });
            
        } catch (e) {
            fs.appendFileSync(debugLog, `[QUIT] Error in force quit: ${e}\n`);
        }
        
        console.error('[QUIT] Force quitting after timeout');
        
        // Try multiple ways to force quit
        try {
            fs.appendFileSync(debugLog, '[QUIT] Trying app.exit(0)\n');
            app.exit(0);  // Try app.exit first
        } catch (e) {
            fs.appendFileSync(debugLog, `[QUIT] app.exit failed: ${e}\n`);
        }
        
        setTimeout(() => {
            try {
                fs.appendFileSync(debugLog, '[QUIT] Trying process.exit(0)\n');
                process.exit(0);  // Then process.exit
            } catch (e) {
                fs.appendFileSync(debugLog, `[QUIT] process.exit failed: ${e}\n`);
            }
            
            setTimeout(() => {
                // Nuclear option - kill the process
                try {
                    fs.appendFileSync(debugLog, '[QUIT] Trying process.kill SIGKILL\n');
                    process.kill(process.pid, 'SIGKILL');
                } catch (e) {
                    fs.appendFileSync(debugLog, `[QUIT] process.kill failed: ${e}\n`);
                }
            }, 500);
        }, 500);
    }, 3000);
    
    // Clear timer if we actually quit
    app.on('will-quit', () => {
        fs.appendFileSync(debugLog, '[QUIT] will-quit event fired!\n');
        clearTimeout(forceQuitTimer);
    });
    
    // Check if we're actually preventing the default quit
    fs.appendFileSync(debugLog, `[QUIT] Event defaultPrevented: ${event.defaultPrevented}\n`);
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
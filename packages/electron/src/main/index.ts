import { app, BrowserWindow, nativeTheme, nativeImage, ipcMain } from 'electron';
import type { SessionStore } from '@stravu/runtime';
import { join } from 'path';
import { existsSync, writeFileSync, appendFileSync } from 'fs';

import { createWindow, windows, windowStates, findWindowByFilePath } from './window/WindowManager';
import { loadFileIntoWindow } from './file/FileOperations';
import { createApplicationMenu, updateApplicationMenu } from './menu/ApplicationMenu';
import { updateNativeTheme, updateWindowTitleBars } from './theme/ThemeManager';
import { saveSessionState, restoreSessionState } from './session/SessionState';
import { createWorkspaceManagerWindow, setupWorkspaceManagerHandlers } from './window/WorkspaceManagerWindow.ts';
import { registerSessionManagerHandlers } from './window/SessionManagerWindow';
import { registerFileHandlers } from './ipc/FileHandlers';
import { registerWorkspaceHandlers } from './ipc/WorkspaceHandlers.ts';
import { registerSettingsHandlers } from './ipc/SettingsHandlers';
import { registerWindowHandlers } from './ipc/WindowHandlers';
import { registerHistoryHandlers } from './ipc/HistoryHandlers';
import { registerSessionHandlers } from './ipc/SessionHandlers';
import { getTheme } from './utils/store';
import { AIService } from './services/ai/AIService';
import { startMcpHttpServer, updateDocumentState, cleanupMcpServer, shutdownHttpServer } from './mcp/httpServer';
import { logger } from './utils/logger';
import { startPerformanceMonitoring, stopPerformanceMonitoring } from './utils/performanceMonitor';
import { setupForceQuit, cancelForceQuit } from './utils/forceQuit';
import { stopAllFileWatchers } from './file/FileWatcher';
import { stopAllWorkspaceWatchers } from './file/WorkspaceWatcher.ts';
import { autoUpdaterService, AutoUpdaterService } from './services/autoUpdater';
import { migrateUserData } from './migration/dataMigration';
import { initializeDatabase } from './database/initialize';
import type { SessionStore } from '@stravu/runtime';

// Track pending file to open
let pendingFilePath: string | null = null;
// Track pending workspace to open
let pendingWorkspacePath: string | null = null;

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
let runtimeSessionStore: SessionStore | null = null;
let mcpHttpServer: any = null;

// Initialize logging
function initializeLogging() {
    // electron-log handles main process logging
    logger.main.info('Application logging initialized');

    // Always capture error logs for debugging
    const debugLogPath = join(app.getPath('userData'), 'preditor-debug.log');

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
        if (args[i] === '--workspace' && i + 1 < args.length) {
            pendingWorkspacePath = args[i + 1];
            logger.main.info(`Workspace path from CLI: ${pendingWorkspacePath}`);
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

    // Migrate user data from old location if needed
    try {
        const migrated = await migrateUserData();
        if (migrated) {
            logger.main.info('User data migration completed');
        }
    } catch (error) {
        logger.main.error('Error during user data migration:', error);
    }

    // Initialize PGLite database
    try {
        runtimeSessionStore = await initializeDatabase();
        logger.main.info('Database initialization completed');
      } catch (error) {
        logger.main.error('Error initializing database:', error);

        // Show error dialog to user
        const { dialog } = require('electron');
        dialog.showErrorBox(
            'Database Initialization Failed',
            `Failed to initialize the database system.\n\nError: ${error.message}\n\nThe application cannot continue without the database.`
        );

        // Exit the app
        app.quit();
        return;
    }

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
    registerWorkspaceHandlers();
    registerSettingsHandlers();
    registerWindowHandlers();
    await registerHistoryHandlers();
    await registerSessionHandlers();
    registerSessionManagerHandlers();
    setupWorkspaceManagerHandlers();

    // Initialize AI service
    if (!runtimeSessionStore) {
        throw new Error('AI session store unavailable after database initialization');
    }
    aiService = new AIService(runtimeSessionStore);

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

    // Try to restore session, otherwise show Workspace Manager
    const sessionRestored = await restoreSessionState();

    if (pendingWorkspacePath) {
        // Handle workspace path from CLI
        const window = createWindow(true);
        window.once('ready-to-show', () => {
            // Send workspace open event to renderer
            window.webContents.send('open-workspace-from-cli', pendingWorkspacePath);
            pendingWorkspacePath = null;
        });
    } else if (!sessionRestored && !pendingFilePath) {
        // No session to restore and no file to open, show Workspace Manager
        createWorkspaceManagerWindow();
    } else if (pendingFilePath) {
        // Handle pending file if we have one
        const window = createWindow(true);
        window.once('ready-to-show', () => {
            loadFileIntoWindow(window, pendingFilePath!);
            pendingFilePath = null;
        });
    }

    // Create application menu
    await createApplicationMenu();

    // Set initial native theme
    updateNativeTheme();

    // Initialize auto-updater (only in production)
    if (app.isPackaged) {
        logger.main.info('Starting auto-updater service');
        autoUpdaterService.startAutoUpdateCheck(60); // Check every hour
    } else {
        logger.main.info('Skipping auto-updater in development mode');
    }

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
    sessionSaveInterval = setInterval(async () => {
        // Only save if app is not quitting
        if (!isAppQuitting) {
            await saveSessionState();
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

        }
    }, 60000); // Check every minute

    // Listen for system theme changes
    let lastNativeDark = nativeTheme.shouldUseDarkColors;
    nativeTheme.on('updated', () => {
        const currentTheme = getTheme();
        const isDark = nativeTheme.shouldUseDarkColors;
        // Only react when:
        //  - app theme is 'system', and
        //  - the effective dark/light value actually changed
        if (currentTheme === 'system' && isDark !== lastNativeDark) {
            lastNativeDark = isDark;
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
    // Avoid resurrecting windows while quitting
    if (isAppQuitting) return;
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Before quit handler
app.on('before-quit', async (event) => {
    console.log('[QUIT] before-quit event triggered');

    // If auto-updater is updating, don't prevent quit
    if (AutoUpdaterService.isUpdatingApp()) {
        console.log('[QUIT] Auto-updater is updating, allowing quit');
        return;
    }

    // If we're already quitting, don't prevent default to avoid infinite loop
    if (isAppQuitting) {
        console.log('[QUIT] Already quitting, allowing default behavior');
        return;
    }

    // Prevent default to do async cleanup
    event.preventDefault();

    // Mark app as quitting to prevent interval operations
    isAppQuitting = true;

    // Setup force quit timer - shorter for notarized builds to prevent hanging
    const forceQuitDelay = app.isPackaged ? 3000 : 2000;
    setupForceQuit(forceQuitDelay);

    const fs = require('fs');
    const path = require('path');
    let debugLog: string | null = null;
    let canWriteLogs = false;

    // Check if we can write to userData directory
    try {
        const userDataPath = app.getPath('userData');
        debugLog = path.join(userDataPath, 'preditor-debug.log');

        // Test write permission
        fs.accessSync(userDataPath, fs.constants.W_OK);
        canWriteLogs = true;
        fs.appendFileSync(debugLog, `\n[QUIT] before-quit event at ${new Date().toISOString()}\n`);
        fs.appendFileSync(debugLog, `[QUIT] User: ${process.env.USER || 'unknown'}, UID: ${process.getuid?.() || 'unknown'}\n`);
    } catch (e) {
        console.error('[QUIT] Cannot write to userData directory:', e);
        canWriteLogs = false;
    }

    try {
        // Clear ALL intervals first (should not fail)
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

        // CRITICAL: Stop performance monitoring - this has an interval that keeps the process alive!
        stopPerformanceMonitoring();

        if (canWriteLogs) {
            logger.session.info('App quitting, intervals cleared');
        }
    } catch (error) {
        console.error('Error clearing intervals:', error);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, `[QUIT] Error clearing intervals: ${error}\n`);
            } catch (e) {}
        }
    }

    // Clean up all file watchers FIRST - these can keep the process alive
    try {
        console.log('[QUIT] About to clean up file watchers');
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, '[QUIT] Cleaning up file watchers\n');
            } catch (e) {}
        }

        console.log('[QUIT] Calling stopAllFileWatchers...');
        stopAllFileWatchers();
        console.log('[QUIT] stopAllFileWatchers returned');

        console.log('[QUIT] Calling stopAllWorkspaceWatchers...');
        stopAllWorkspaceWatchers();
        console.log('[QUIT] stopAllWorkspaceWatchers returned');

        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, '[QUIT] File watchers cleaned up\n');
            } catch (e) {}
        }
    } catch (error) {
        console.error('[QUIT] Error cleaning up file watchers:', error);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, `[QUIT] Error cleaning up file watchers: ${error}\n`);
            } catch (e) {}
        }
    }

    try {
        // Clean up AI service
        if (aiService) {
            if (canWriteLogs && debugLog) {
                try {
                    fs.appendFileSync(debugLog, '[QUIT] Destroying AI service\n');
                } catch (e) {}
            }
            aiService.destroy();
            aiService = null;
        }
    } catch (error) {
        console.error('[QUIT] Error destroying AI service:', error);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, `[QUIT] Error destroying AI service: ${error}\n`);
            } catch (e) {}
        }
    }

    try {
        // Shutdown MCP HTTP server with timeout
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, '[QUIT] Shutting down MCP HTTP server\n');
            } catch (e) {}
        }

        // Add timeout to prevent hanging
        const shutdownPromise = shutdownHttpServer();
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 500));
        await Promise.race([shutdownPromise, timeoutPromise]);

        mcpHttpServer = null;

        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, '[QUIT] MCP HTTP server shutdown complete\n');
            } catch (e) {}
        }
    } catch (error) {
        console.error('[QUIT] Error closing MCP server:', error);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, `[QUIT] Error closing MCP server: ${error}\n`);
            } catch (e) {}
        }
    }

    try {
        // Save session state only if we can write
        if (canWriteLogs) {
            if (debugLog) {
                try {
                    fs.appendFileSync(debugLog, '[QUIT] Saving session state\n');
                } catch (e) {}
            }

            // Wrap session save with timeout
            const savePromise = new Promise(async (resolve, reject) => {
                try {
                    await saveSessionState();
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            });
            const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 300));
            await Promise.race([savePromise, timeoutPromise]);

            if (debugLog) {
                try {
                    fs.appendFileSync(debugLog, '[QUIT] Session state saved\n');
                } catch (e) {}
            }
        } else {
            console.log('[QUIT] Skipping session save - no write permissions');
        }
    } catch (error) {
        console.error('[QUIT] Error saving session state:', error);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, `[QUIT] Error saving session: ${error}\n`);
            } catch (e) {}
        }
    }

    // After all cleanup, quit the app
    if (canWriteLogs && debugLog) {
        try {
            fs.appendFileSync(debugLog, '[QUIT] All cleanup complete, quitting app\n');

            // Log what's still keeping the process alive
            const activeHandles = (process as any)._getActiveHandles?.();
            const activeRequests = (process as any)._getActiveRequests?.();

            if (activeHandles && activeHandles.length > 0) {
                fs.appendFileSync(debugLog, `[QUIT] WARNING: ${activeHandles.length} handles still active:\n`);
                activeHandles.forEach((handle: any, i: number) => {
                    const name = handle.constructor.name;
                    let details = `  ${i}: ${name}`;
                    if (name === 'Server' || name === 'Socket' || name === 'TCP') {
                        try {
                            details += ` (address: ${handle.address?.() || 'unknown'})`;
                        } catch (e) {}
                    }
                    if (name === 'FSWatcher') {
                        details += ' (file watcher!) - FORCE CLOSING';
                        // Force close ANY FSWatcher we find
                        try {
                            handle.close();
                            fs.appendFileSync(debugLog, `    FORCE CLOSED FSWatcher ${i}\n`);
                        } catch (e) {
                            fs.appendFileSync(debugLog, `    Failed to force close: ${e}\n`);
                        }
                    }
                    if (name === 'Timer' || name === 'Timeout') {
                        details += ' (timer/interval!)';
                    }
                    fs.appendFileSync(debugLog, details + '\n');
                });
            }

            if (activeRequests && activeRequests.length > 0) {
                fs.appendFileSync(debugLog, `[QUIT] WARNING: ${activeRequests.length} requests still active\n`);
            }
        } catch (e) {}
    }

    // Aggressively close all windows to avoid any close prompts or handlers
    try {
        const all = BrowserWindow.getAllWindows();
        if (canWriteLogs && debugLog) {
            try { fs.appendFileSync(debugLog, `[QUIT] Destroying ${all.length} windows\n`); } catch (e) {}
        }
        for (const win of all) {
            try {
                win.removeAllListeners('close');
                if (!win.isDestroyed()) win.destroy();
            } catch {}
        }
    } catch {}

    // Ensure process terminates even if something re-hooks quit
    // Use a short delay to allow logs to flush
    setTimeout(() => {
        try { app.exit(0); } catch {}
    }, 50);
});

// Window all closed handler
app.on('window-all-closed', () => {
  logger.main.info('All windows closed');
  // On macOS, keep app running when all windows are closed
  // and show the Workspace Manager, but NOT when we are quitting.
  if (process.platform === 'darwin') {
    if (!isAppQuitting) {
      // Only show the Workspace Manager when not quitting the app
      createWorkspaceManagerWindow();
    }
    // If we are quitting, do nothing here and allow normal quit to proceed
  } else {
    // On other platforms, quit when all windows are closed
    app.quit();
  }
});

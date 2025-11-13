import { app, BrowserWindow, nativeTheme, nativeImage, ipcMain, globalShortcut, dialog } from 'electron';
import type { SessionStore } from '@nimbalyst/runtime';
import { join } from 'path';
import * as path from 'path';
import { existsSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
import * as fs from 'fs';

// CRITICAL: Hide dock icon when running as background Node process
// This prevents Terminal icon from appearing when Claude Code spawns child processes
if (process.env.ELECTRON_RUN_AS_NODE === '1' && process.platform === 'darwin') {
  // When Electron runs as Node (ELECTRON_RUN_AS_NODE=1), hide from dock
  // This must happen before app.whenReady()
  if (app.dock) {
    app.dock.hide();
  }
}

import { createWindow, windows, windowStates, findWindowByFilePath } from './window/WindowManager';
import { loadFileIntoWindow } from './file/FileOperations';
import { createApplicationMenu, updateApplicationMenu } from './menu/ApplicationMenu';
import { createAIModelsWindow } from './window/AIModelsWindow';
import { updateNativeTheme, updateWindowTitleBars } from './theme/ThemeManager';
import { saveSessionState, restoreSessionState } from './session/SessionState';
import { createWorkspaceManagerWindow, setupWorkspaceManagerHandlers } from './window/WorkspaceManagerWindow.ts';
import './window/AgenticCodingWindow'; // Register IPC handlers
import { registerFileHandlers } from './ipc/FileHandlers';
import { registerWorkspaceHandlers } from './ipc/WorkspaceHandlers.ts';
import { registerSettingsHandlers } from './ipc/SettingsHandlers';
import { registerWindowHandlers } from './ipc/WindowHandlers';
import { registerHistoryHandlers } from './ipc/HistoryHandlers';
import { registerSessionHandlers } from './ipc/SessionHandlers';
import { registerAttachmentHandlers } from './ipc/AttachmentHandlers';
import { registerWorkspaceWatcherHandlers } from './file/WorkspaceWatcher';
import { setupSessionFileHandlers } from './ipc/SessionFileHandlers';
import { registerSlashCommandHandlers } from './ipc/SlashCommandHandlers';
import { registerClaudeCodeHandlers } from './ipc/ClaudeCodeHandlers';
import { registerNotificationHandlers } from './ipc/NotificationHandlers';
import { registerGitStatusHandlers } from './ipc/GitStatusHandlers';
import { getTheme, setTheme, incrementLaunchCount, shouldShowDiscordInvitation, dismissDiscordInvitation, isFirstLaunch, markAppLaunched, type AppTheme } from './utils/store';
import { AIService } from './services/ai/AIService';
// import { AgentService } from './services/agents/AgentService';
import { cliManager } from './services/CLIManager';
import { startMcpHttpServer, updateDocumentState, registerWorkspaceWindow, cleanupMcpServer, shutdownHttpServer } from './mcp/httpServer';
import { logger, overrideConsole } from './utils/logger';
import { startPerformanceMonitoring, stopPerformanceMonitoring } from './utils/performanceMonitor';
import { setupForceQuit, cancelForceQuit } from './utils/forceQuit';
import { stopAllFileWatchers } from './file/FileWatcher';
import { stopAllWorkspaceWatchers } from './file/WorkspaceWatcher.ts';
import { autoUpdaterService, AutoUpdaterService } from './services/autoUpdater';
import { initializeDatabase } from './database/initialize';
import {AnalyticsService} from "./services/analytics/AnalyticsService.ts";
import {registerAnalyticsHandlers} from "./ipc/AnalyticsHandlers.ts";

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

// Single instance lock removed - allow multiple instances to run

const analytics = AnalyticsService.getInstance();

// AI service instance
let aiService: AIService | null = null;
// let agentService: AgentService | null = null;
let runtimeSessionStore: SessionStore | null = null;
let mcpHttpServer: any = null;

// Initialize logging
function initializeLogging() {
    // electron-log handles main process logging
    logger.main.info('Application logging initialized');

    // Always capture error logs for debugging
    const debugLogPath = join(app.getPath('userData'), 'nimbalyst-debug.log');

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
    logger.main.info(`Full process.argv:`, process.argv);
    const args = process.argv.slice(app.isPackaged ? 1 : 2);
    logger.main.info(`Parsing command line args (after slice):`, args);

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        logger.main.info(`Checking arg[${i}]: "${arg}"`);

        if (arg === '--workspace' && i + 1 < args.length) {
            pendingWorkspacePath = args[i + 1];
            logger.main.info(`✓ Workspace path from CLI: ${pendingWorkspacePath}`);
        } else if (!arg.startsWith('--') && !arg.startsWith('-')) {
            // Handle plain file path argument (e.g., "preditor file.md")
            const argExists = existsSync(arg);
            const argIsMarkdown = arg.endsWith('.md');
            logger.main.info(`  Potential file: exists=${argExists}, isMarkdown=${argIsMarkdown}`);

            if (argExists && argIsMarkdown) {
                pendingFilePath = arg;
                logger.main.info(`✓ File path from CLI: ${pendingFilePath}`);
            }
        }
    }

    logger.main.info(`FINAL: pendingFilePath=${pendingFilePath}, pendingWorkspacePath=${pendingWorkspacePath}`);
}


// App ready handler
app.whenReady().then(async () => {
    // Override console methods to capture all console output in log file
    // This must be called FIRST before any console.log calls
    overrideConsole();

    logger.main.info('App ready');

    // Track app launch for Discord invitation
    const launchCount = incrementLaunchCount();
    logger.main.info(`App launch count: ${launchCount}`);

    // Parse command line arguments
    parseCommandLineArgs();

    // Initialize logging
    initializeLogging();

    // Initialize PGLite database
    try {
        runtimeSessionStore = await initializeDatabase();
        logger.main.info('Database initialization completed');
      } catch (error) {
        logger.main.error('Error initializing database:', error);

        // Show error dialog to user
        const errorMessage = error instanceof Error ? error.message : String(error);
        dialog.showErrorBox(
            'Database Initialization Failed',
            `Failed to initialize the database system.\n\nError: ${errorMessage}\n\nThe application cannot continue without the database.`
        );

        // Exit the app
        app.quit();
        return;
    }

    // Set dock icon for macOS
    if (process.platform === 'darwin' && app.dock) {
        // In dev mode, use icon from root; in production, use from resources
        const iconPath = app.isPackaged
            ? join(__dirname, '../../resources/icon.png')
            : join(__dirname, '../../icon.png');

        if (existsSync(iconPath)) {
            const dockIcon = nativeImage.createFromPath(iconPath);
            app.dock.setIcon(dockIcon);
            // logger.main.info('Dock icon set successfully from:', iconPath);
        } else {
            logger.main.warn(`icon not found at: ${iconPath}`);
        }
    }

    // Register all IPC handlers
    registerFileHandlers();
    registerWorkspaceHandlers();
    registerWorkspaceWatcherHandlers();
    registerSettingsHandlers();
    registerWindowHandlers();
    await registerHistoryHandlers();
    await registerSessionHandlers();
    setupWorkspaceManagerHandlers();
    setupSessionFileHandlers();
    registerSlashCommandHandlers();
    registerAttachmentHandlers();
    registerClaudeCodeHandlers();
    registerAnalyticsHandlers();
    registerNotificationHandlers();
    registerGitStatusHandlers();

    // Initialize AI service
    if (!runtimeSessionStore) {
        throw new Error('AI session store unavailable after database initialization');
    }
    aiService = new AIService(runtimeSessionStore);

    // Initialize Agent service
    // agentService = new AgentService(aiService);

    // Start MCP SSE server
    try {
        const result = await startMcpHttpServer(3456);
        mcpHttpServer = result.httpServer;
        logger.mcp.info('MCP SSE server started on port', result.port);

        // Store the actual port for providers to use
        (global as any).mcpServerPort = result.port;
    } catch (error) {
            logger.mcp.error('Failed to start MCP SSE server:', error);
    }

    // Set up IPC handler to update document state for MCP
    ipcMain.on('mcp:updateDocumentState', (event, state) => {
        // Get the window that sent this message
        const window = BrowserWindow.fromWebContents(event.sender);
        const windowId = window?.id;

        // Register the workspace-to-window mapping for routing
        if (state?.workspacePath && windowId) {
            // logger.mcp.info(`Registering workspace ${state.workspacePath} -> window ${windowId}`);
            registerWorkspaceWindow(state.workspacePath, windowId);
        } else {
            logger.mcp.warn(`Cannot register workspace: workspacePath=${state?.workspacePath}, windowId=${windowId}`);
        }

        // Update document state with the workspace path (canonical identifier)
        updateDocumentState(state);
    });

    // Set up IPC handler for theme changes from renderer
    ipcMain.on('set-theme', (event, theme: AppTheme) => {
        setTheme(theme);
        updateNativeTheme();
        BrowserWindow.getAllWindows().forEach(window => {
            window.webContents.send('theme-change', theme);
        });
        updateWindowTitleBars();
    });

    // Set up IPC handler for Discord invitation dismissal
    ipcMain.on('dismiss-discord-invitation', (event) => {
        logger.main.info('User dismissed Discord invitation permanently');
        dismissDiscordInvitation();
    });

    // Check if this is the first launch
    // In tests, can force first launch with FORCE_FIRST_LAUNCH env var
    const firstLaunch = process.env.FORCE_FIRST_LAUNCH === '1' || isFirstLaunch();

    // Try to restore session, otherwise show Workspace Manager or Settings (on first launch)
    const sessionRestored = await restoreSessionState();

    if (pendingWorkspacePath) {
        // Handle workspace path from CLI
        const workspacePath = pendingWorkspacePath;
        pendingWorkspacePath = null;

        // Track workspace opened from CLI
        try {
            const { readdirSync, statSync } = await import('fs');
            const { join } = await import('path');

            // Count files in workspace
            let fileCount = 0;
            let hasSubfolders = false;
            try {
                const entries = readdirSync(workspacePath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile()) {
                        fileCount++;
                    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        hasSubfolders = true;
                    }
                }
            } catch (error) {
                // Ignore count errors
            }

            // Bucket file count
            let fileCountBucket = '1-10';
            if (fileCount > 100) fileCountBucket = '100+';
            else if (fileCount > 50) fileCountBucket = '51-100';
            else if (fileCount > 10) fileCountBucket = '11-50';

            analytics.sendEvent('workspace_opened', {
                fileCount: fileCountBucket,
                hasSubfolders,
                source: 'cli',
            });
        } catch (error) {
            logger.main.error('Error tracking workspace_opened event:', error);
        }

        // Ensure .nimbalyst/trackers/ directory exists
        // DISABLED FOR NOW - test creates it
        // if (workspacePath) {
        //     const { getTrackerLoaderService } = await import('./services/TrackerLoaderService');
        //     await getTrackerLoaderService().ensureTrackersDirectory(workspacePath);
        // }

        const window = createWindow(false, true, workspacePath);
        window.once('ready-to-show', () => {
            window.show();
            // Notify renderer to ensure workspace UI syncs with the selected path
            window.webContents.send('open-workspace-from-cli', workspacePath);
        });
    } else if (!sessionRestored && !pendingFilePath) {
        // No session to restore and no file to open
        if (firstLaunch) {
            // First launch: show AI Models with Getting Started
            logger.main.info('First launch detected, showing AI Models window with Getting Started');
            markAppLaunched();
            createAIModelsWindow(true);
        } else {
            // Regular launch: show Workspace Manager
            createWorkspaceManagerWindow();
        }
    } else if (pendingFilePath) {
        // Handle pending file if we have one
        const window = createWindow(true);
        window.once('ready-to-show', () => {
            window.show();
            // Wait for renderer to finish initializing before sending file
            // The renderer needs time to register IPC handlers
            setTimeout(() => {
                loadFileIntoWindow(window, pendingFilePath!);
                pendingFilePath = null;
            }, 100); // Give renderer 100ms to initialize
        });
    }

    // Check if we should show Discord invitation after windows are fully loaded
    // Skip in Playwright test environment
    if (shouldShowDiscordInvitation() && !process.env.PLAYWRIGHT) {
        // Set up a listener to show invitation when a workspace window finishes loading
        const showInvitationOnWindowReady = () => {
            const allWindows = BrowserWindow.getAllWindows();
            logger.main.info(`Discord invitation check: ${allWindows.length} windows available`);

            // Find a workspace window (not special windows like workspace-manager)
            const workspaceWindow = allWindows.find(win => {
                const url = win.webContents.getURL();
                return !url.includes('mode=workspace-manager') &&
                       !url.includes('mode=session-manager') &&
                       !url.includes('mode=ai-models');
            });

            if (workspaceWindow && workspaceWindow.webContents.isLoading() === false) {
                logger.main.info('Showing Discord invitation to user');
                // Wait a bit for React to mount and register IPC handlers
                setTimeout(() => {
                    workspaceWindow.webContents.send('show-discord-invitation');
                }, 500);
                return true;
            }
            return false;
        };

        // Try immediately in case windows are already loaded
        setTimeout(() => {
            if (!showInvitationOnWindowReady()) {
                // If not ready yet, wait and try again
                setTimeout(showInvitationOnWindowReady, 3000);
            }
        }, 2000);
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
            // Send RESOLVED theme (light or dark) to all windows
            const resolvedTheme = isDark ? 'dark' : 'light';
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('theme-change', resolvedTheme);
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

    let debugLog: string | null = null;
    let canWriteLogs = false;

    // stop analytics
    await analytics.destroy();

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
        const t1 = Date.now();
        console.log(`[QUIT] [${t1}] About to clean up file watchers`);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, '[QUIT] Cleaning up file watchers\n');
            } catch (e) {}
        }

        console.log(`[QUIT] [${t1}] Calling stopAllFileWatchers...`);
        await stopAllFileWatchers();
        const t2 = Date.now();
        console.log(`[QUIT] [${t2}] stopAllFileWatchers returned (${t2-t1}ms)`);

        console.log(`[QUIT] [${t2}] Calling stopAllWorkspaceWatchers...`);
        await stopAllWorkspaceWatchers();
        const t3 = Date.now();
        console.log(`[QUIT] [${t3}] stopAllWorkspaceWatchers returned (${t3-t2}ms)`);

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
        const t4 = Date.now();
        console.log(`[QUIT] [${t4}] Cleaning up AI service`);
        if (aiService) {
            if (canWriteLogs && debugLog) {
                try {
                    fs.appendFileSync(debugLog, '[QUIT] Destroying AI service\n');
                } catch (e) {}
            }
            aiService.destroy();
            aiService = null;
        }
        const t5 = Date.now();
        console.log(`[QUIT] [${t5}] AI service cleanup complete (${t5-t4}ms)`);
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
        const t6 = Date.now();
        console.log(`[QUIT] [${t6}] Shutting down MCP HTTP server`);
        if (canWriteLogs && debugLog) {
            try {
                fs.appendFileSync(debugLog, '[QUIT] Shutting down MCP HTTP server\n');
            } catch (e) {}
        }

        // Add timeout to prevent hanging
        const shutdownPromise = shutdownHttpServer();
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 500));
        await Promise.race([shutdownPromise, timeoutPromise]);
        const t7 = Date.now();
        console.log(`[QUIT] [${t7}] MCP HTTP server shutdown complete (${t7-t6}ms)`);

        mcpHttpServer = null;

        // Clean up CLI manager
        const t8 = Date.now();
        console.log(`[QUIT] [${t8}] Cleaning up CLI manager`);
        cliManager.cleanup();
        const t9 = Date.now();
        console.log(`[QUIT] [${t9}] CLI manager cleanup complete (${t9-t8}ms)`);

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
        // CRITICAL: Save session state BEFORE destroying windows
        // Destroying windows removes them from the windows Map, so save must happen first
        const t10 = Date.now();
        console.log(`[QUIT] [${t10}] Saving session state`);
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
            const t11 = Date.now();
            console.log(`[QUIT] [${t11}] Session state saved (${t11-t10}ms)`);

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

    // Aggressively close all windows to avoid any close prompts or handlers
    // IMPORTANT: This must happen AFTER saving session state
    try {
        const t12 = Date.now();
        const all = BrowserWindow.getAllWindows();
        console.log(`[QUIT] [${t12}] Destroying ${all.length} windows`);
        if (canWriteLogs && debugLog) {
            try { fs.appendFileSync(debugLog, `[QUIT] Destroying ${all.length} windows\n`); } catch (e) {}
        }
        for (const win of all) {
            try {
                win.removeAllListeners('close');
                if (!win.isDestroyed()) win.destroy();
            } catch {}
        }
        const t13 = Date.now();
        console.log(`[QUIT] [${t13}] Windows destroyed (${t13-t12}ms)`);
    } catch {}

    // After all cleanup, quit the app
    const t14 = Date.now();
    console.log(`[QUIT] [${t14}] All cleanup complete, checking for active handles`);
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

    // Ensure process terminates even if something re-hooks quit
    // Use a short delay to allow logs to flush
    const t15 = Date.now();
    console.log(`[QUIT] [${t15}] Setting exit timeout`);
    setTimeout(() => {
        const t16 = Date.now();
        console.log(`[QUIT] [${t16}] Calling app.exit(0) (${t16-t15}ms after timeout set)`);
        try { app.exit(0); } catch {}
    }, 50);
});

// Window all closed handler
app.on('window-all-closed', () => {
  logger.main.info('All windows closed');
  if (!isAppQuitting) {
    // Only show the Workspace Manager when not quitting the app
    createWorkspaceManagerWindow();
    // If we are quitting, do nothing here and allow normal quit to proceed
  } else {
    // On other platforms, quit when all windows are closed
    app.quit();
  }
});

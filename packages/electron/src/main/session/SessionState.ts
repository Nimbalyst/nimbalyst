import { BrowserWindow } from 'electron';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { windows, windowStates, createWindow, windowFocusOrder, windowDevToolsState, getWindowId } from '../window/WindowManager';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getSessionState, saveSessionState as saveToStore, SessionState, clearSessionState } from '../utils/store';
import { startWorkspaceWatcher } from '../file/WorkspaceWatcher.ts';
import { getFolderContents } from '../utils/FileTree';
import { basename } from 'path';
import { logger } from '../utils/logger';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { GitStatusService } from '../services/GitStatusService';
import { autoMatchTeamForWorkspace } from '../services/TeamService';

// Save session state
export async function saveSessionState() {
    const sessionWindows: any[] = [];

    for (const [windowId, window] of windows) {
        const state = windowStates.get(windowId);
        if (!state || window.isDestroyed()) continue;

        // Don't save untitled empty documents
        if (state.mode === 'document' && !state.filePath && !state.documentEdited) {
            continue;
        }

        const bounds = window.getBounds();
        const focusOrder = windowFocusOrder.get(windowId) || 0;
        const devToolsOpen = windowDevToolsState.get(windowId) || false;
        const sessionWindow: any = {
            mode: state.mode,
            bounds,
            focusOrder,
            devToolsOpen
        };

        if (state.filePath) {
            sessionWindow.filePath = state.filePath;
        }
        if (state.workspacePath) {
            sessionWindow.workspacePath = state.workspacePath;
        }

        sessionWindows.push(sessionWindow);
    }

    const sessionState: SessionState = {
        windows: sessionWindows,
        lastUpdated: Date.now()
    };

    // logger.session.info('[SAVE] Saving session state:', JSON.stringify(sessionState, null, 2));
    saveToStore(sessionState);

    // Verify the save by reading it back
    const verified = getSessionState();
    // logger.session.info('[SAVE] Verified session state:', JSON.stringify(verified, null, 2));
}

// Restore session state
// Returns the last created window (highest focus order) so the caller can activate it,
// or null if no windows were restored.
export async function restoreSessionState(): Promise<BrowserWindow | null> {
    // In test mode (PLAYWRIGHT=1), always clear and skip session restoration
    // Tests that want to test restoration will not set PLAYWRIGHT env var at all
    if (process.env.PLAYWRIGHT === '1') {
        logger.session.info('Test mode: clearing and skipping session restoration');
        clearSessionState();
        return null;
    }

    const sessionState = getSessionState();

    // logger.session.info('[RESTORE] Retrieved session state:', JSON.stringify(sessionState, null, 2));

    if (!sessionState || !sessionState.windows || sessionState.windows.length === 0) {
        logger.session.info('[RESTORE] No session state to restore (empty or missing)');
        return null;
    }

    // logger.session.info(`[RESTORE] Restoring session with ${sessionState.windows.length} window(s)`);

    // Sort windows by focus order - LOWEST first, HIGHEST last
    // Windows are shown in creation order, and macOS will naturally focus the last shown window
    const sortedWindows = [...sessionState.windows].sort((a, b) => {
        const aOrder = a.focusOrder || 0;
        const bOrder = b.focusOrder || 0;
        return aOrder - bOrder;
    });

    logger.session.info(`Window creation order (by focusOrder):`, sortedWindows.map((w, i) =>
        `${i}: ${w.mode} focusOrder=${w.focusOrder}`
    ));

    // Restore each window in order
    // Use async creation to ensure windows are created sequentially
    // Track the last successfully created window (highest focus order) for activation
    let lastWindow: BrowserWindow | null = null;

    for (let index = 0; index < sortedWindows.length; index++) {
        const sessionWindow = sortedWindows[index];

        // Wait for previous window to be ready before creating next
        await new Promise<void>((resolve) => {
            setTimeout(async () => {
                let window: BrowserWindow | null = null;

                if (sessionWindow.mode === 'workspace' && sessionWindow.workspacePath) {
                    // Check if workspace path still exists
                    if (existsSync(sessionWindow.workspacePath)) {
                        // Track workspace opened from startup restore
                        try {
                            // Count files and check for subfolders
                            let fileCount = 0;
                            let hasSubfolders = false;
                            try {
                                const entries = readdirSync(sessionWindow.workspacePath, { withFileTypes: true });
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

                            // Check git repository status (defaults to false if git not available)
                            let isGitRepository = false;
                            let isGitHub = false;

                            try {
                                const gitStatusService = new GitStatusService();
                                isGitRepository = await gitStatusService.isGitRepo(sessionWindow.workspacePath);
                                if (isGitRepository) {
                                    isGitHub = await gitStatusService.hasGitHubRemote(sessionWindow.workspacePath);
                                }
                            } catch (gitError) {
                                // Git checks failed - continue with defaults (false, false)
                                logger.session.error('Error checking git status:', gitError);
                            }

                            const analytics = AnalyticsService.getInstance();
                            analytics.sendEvent('workspace_opened', {
                                fileCount: fileCountBucket,
                                hasSubfolders,
                                source: 'startup_restore',
                                isGitRepository,
                                isGitHub,
                            });
                        } catch (error) {
                            logger.session.error('Error tracking workspace_opened event:', error);
                        }

                        // Restore workspace window (showInactive to avoid repeated app activation)
                        window = createWindow(false, true, sessionWindow.workspacePath, sessionWindow.bounds, { showInactive: true });
                        logger.session.info(`Restored workspace window: ${sessionWindow.workspacePath}`);

                        const restoredWorkspacePath = sessionWindow.workspacePath;
                        setTimeout(() => {
                            // Yield before running background workspace matching so
                            // restored windows don't block the startup tick.
                            void autoMatchTeamForWorkspace(restoredWorkspacePath).catch(() => {});
                        }, 0);

                        // Note: Workspace tabs will be restored by the workspace's own tab state management
                        // We don't manually open files here to avoid interfering with tab restoration
                    } else {
                        logger.session.warn(`Workspace path no longer exists: ${sessionWindow.workspacePath}`);
                    }
                } else if (sessionWindow.mode === 'document' && sessionWindow.filePath) {
                    // Check if file still exists
                    if (existsSync(sessionWindow.filePath)) {
                        // Restore document window (showInactive to avoid repeated app activation)
                        window = createWindow(true, false, undefined, sessionWindow.bounds, { showInactive: true });
                        if (window) {
                            window.once('ready-to-show', () => {
                                loadFileIntoWindow(window!, sessionWindow.filePath!);
                            });
                            logger.session.info(`Restored document window: ${sessionWindow.filePath}`);
                        }
                    } else {
                        logger.session.warn(`File no longer exists: ${sessionWindow.filePath}`);
                    }
                }

                // Restore dev tools state
                if (window && sessionWindow.devToolsOpen) {
                    // Wait for window to be ready before opening dev tools
                    window.webContents.once('did-finish-load', () => {
                        window.webContents.openDevTools();
                    });
                }

                if (window) {
                    lastWindow = window;
                }

                resolve();
            }, 300); // 300ms delay between each window creation
        });
    }

    return lastWindow;
}

/**
 * Application menu builder for Nimbalyst Electron app.
 *
 * Creates and manages the native application menu bar with support for:
 * - File operations (new, open, save, recent items)
 * - Edit commands (undo/redo, copy/paste, find/replace)
 * - View modes (files, agent) and panels (AI chat, bottom panel)
 * - Window management (minimize, close, window list with keyboard shortcuts)
 * - Theme switching (light, dark, crystal-dark, system)
 * - Developer tools (console, file watcher diagnostics, database server)
 * - Help and documentation
 *
 * The menu adapts based on:
 * - Platform (macOS vs Windows/Linux)
 * - Window state (workspace vs document mode)
 * - Active mode (files vs agent mode for context-aware New command)
 * - Development vs production build (shows/hides dev-only features)
 *
 * Menu updates are triggered when:
 * - Theme changes
 * - Recent items change
 * - Windows are opened/closed/focused
 */
import { Menu, BrowserWindow, app, dialog, shell, nativeTheme } from 'electron';
import { basename, join } from 'path';
import * as path from 'path';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import * as fs from 'fs';
import { windows, windowStates, createWindow, findWindowByFilePath, getWindowId } from '../window/WindowManager';
import { createAboutWindow } from '../window/AboutWindow';
import { createWorkspaceManagerWindow } from '../window/WorkspaceManagerWindow.ts';
import { createAIUsageReportWindow } from '../window/AIUsageReportWindow';
import { createDatabaseBrowserWindow } from '../window/DatabaseBrowserWindow';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getRecentItems, clearRecentItems, addToRecentItems, getTheme, setTheme, store, getWorkspaceState, getWorkspaceWindowState } from '../utils/store';
import { updateWindowTitleBars, updateNativeTheme } from '../theme/ThemeManager';
import { getFileWatcherStatus, refreshWorkspaceFileTree, getGlobalFileWatcherStats } from '../file/FileWatcherDebug';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { getFocusedWindow } from '../utils/windowFocus';
import { autoUpdaterService } from '../services/autoUpdater';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { AnalyticsService } from '../services/analytics/AnalyticsService';
import { FeatureTrackingService } from '../services/analytics/FeatureTrackingService';

// Create window list menu items
function createWindowListMenu(): any[] {
    const menuItems: any[] = [];
    const allWindows = BrowserWindow.getAllWindows();

    if (allWindows.length === 0) {
        return [];
    }

    // Categorize windows
    const workspaceWindows: { window: BrowserWindow; title: string }[] = [];
    const documentWindows: { window: BrowserWindow; title: string }[] = [];
    const otherWindows: { window: BrowserWindow; title: string }[] = [];

    allWindows.forEach((window) => {
        // Skip destroyed windows
        if (!window || window.isDestroyed()) {
            return;
        }

        const windowId = getWindowId(window);
        const state = windowId !== null ? windowStates.get(windowId) : undefined;
        let title = 'Untitled';
        let category: 'workspace' | 'document' | 'other' = 'document';

        // Check for special windows first
        if (isWorkspaceManagerWindow(window)) {
            title = 'Project Manager';
            category = 'other';
        } else if (isAboutWindow(window)) {
            title = 'About';
            category = 'other';
        } else if (state) {
            if (state.mode === 'workspace' && state.workspacePath) {
                const workspaceName = basename(state.workspacePath);
                if (state.filePath) {
                    const fileName = basename(state.filePath);
                    title = `${fileName} - ${workspaceName}`;
                } else {
                    title = workspaceName;
                }
                category = 'workspace';
            } else if (state.filePath) {
                title = basename(state.filePath);
                category = 'document';
            }

            // Add dirty indicator
            if (state.documentEdited) {
                title = `${title} •`;
            }
        }

        // Add to appropriate category
        if (category === 'workspace') {
            workspaceWindows.push({ window, title });
        } else if (category === 'document') {
            documentWindows.push({ window, title });
        } else {
            otherWindows.push({ window, title });
        }
    });

    // Build menu items with groups
    let shortcutIndex = 0;

    // Add workspace windows
    if (workspaceWindows.length > 0) {
        if (menuItems.length > 0) {
            menuItems.push({ type: 'separator' });
        }
        menuItems.push({ label: 'Open Projects', enabled: false });
        workspaceWindows.forEach(({ window, title }) => {
            const accelerator = shortcutIndex < 9 ? `CmdOrCtrl+${shortcutIndex + 1}` : undefined;
            shortcutIndex++;
            menuItems.push({
                label: title,
                accelerator,
                type: 'checkbox',
                checked: !window.isDestroyed() && window.isFocused(),
                click: async () => {
                    if (!window.isDestroyed()) {
                        window.focus();
                    }
                }
            });
        });
    }

    // Add document windows
    if (documentWindows.length > 0) {
        if (menuItems.length > 0) {
            menuItems.push({ type: 'separator' });
        }
        menuItems.push({ label: 'Open Documents', enabled: false });
        documentWindows.forEach(({ window, title }) => {
            const accelerator = shortcutIndex < 9 ? `CmdOrCtrl+${shortcutIndex + 1}` : undefined;
            shortcutIndex++;
            menuItems.push({
                label: title,
                accelerator,
                type: 'checkbox',
                checked: !window.isDestroyed() && window.isFocused(),
                click: async () => {
                    if (!window.isDestroyed()) {
                        window.focus();
                    }
                }
            });
        });
    }

    // Add other windows
    // if (otherWindows.length > 0) {
    //     if (menuItems.length > 0) {
    //         menuItems.push({ type: 'separator' });
    //     }
    //     menuItems.push({ label: 'Other Windows', enabled: false });
    //     otherWindows.forEach(({ window, title }) => {
    //         const accelerator = shortcutIndex < 9 ? `CmdOrCtrl+${shortcutIndex + 1}` : undefined;
    //         shortcutIndex++;
    //         menuItems.push({
    //             label: title,
    //             accelerator,
    //             type: 'checkbox',
    //             checked: window.isFocused(),
    //             click: async () => {
    //                 window.focus();
    //             }
    //         });
    //     });
    // }

    return menuItems;
}

// Create the recent submenu
async function createRecentSubmenu(): Promise<any[]> {
    const recentWorkspaces = await getRecentItems('workspaces');
    const recentDocuments = await getRecentItems('documents');
    const submenu: any[] = [];

    // Recent Workspaces section
    if (recentWorkspaces.length > 0) {
        submenu.push({ label: 'Recent Projects', enabled: false });
        recentWorkspaces.forEach(workspace => {
            submenu.push({
                label: workspace.name,
                click: async () => {
                    // Check if workspace exists
                    if (existsSync(workspace.path)) {
                        // Check for saved workspace window state
                        const savedState = getWorkspaceWindowState(workspace.path);

                        // Create window with saved bounds if available
                        const window = createWindow(false, true, workspace.path, savedState?.bounds);

                        // Restore dev tools if they were open
                        if (savedState?.devToolsOpen) {
                            window.webContents.once('did-finish-load', () => {
                                window.webContents.openDevTools();
                            });
                        }
                    } else {
                        // Remove from recent if doesn't exist
                        const items = getRecentItems('workspaces').filter(item => item.path !== workspace.path);
                        store.set('recent.workspaces', items);
                        updateApplicationMenu();
                        dialog.showErrorBox('Workspace Not Found', `The workspace "${workspace.name}" could not be found at:\n${workspace.path}`);
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
                click: async () => {
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
    if (recentWorkspaces.length > 0 || recentDocuments.length > 0) {
        submenu.push({ type: 'separator' });

        if (recentWorkspaces.length > 0) {
            submenu.push({
                label: 'Clear Recent Projects',
                click: async () => {
                    clearRecentItems('workspaces');
                    updateApplicationMenu();
                }
            });
        }

        if (recentDocuments.length > 0) {
            submenu.push({
                label: 'Clear Recent Documents',
                click: async () => {
                    clearRecentItems('documents');
                    updateApplicationMenu();
                }
            });
        }
    }

    // If no recent items
    if (submenu.length === 0) {
        submenu.push({ label: 'No Recent Items', enabled: false });
    }

    return submenu;
}

// Install a built-in agent to the workspace
async function installBuiltinAgent(window: BrowserWindow, agentFileName: string) {
    const windowState = windowStates.get(window.id);
    if (!windowState || windowState.mode !== 'workspace' || !windowState.workspacePath) {
        dialog.showMessageBox(window, {
            type: 'warning',
            title: 'No Workspace',
            message: 'Please open a workspace before installing agents.',
            buttons: ['OK']
        });
        return;
    }

    const workspacePath = windowState.workspacePath;
    const agentsDir = join(workspacePath, 'agents');
    const targetPath = join(agentsDir, agentFileName);

    // Check if agent already exists
    if (existsSync(targetPath)) {
        const result = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Agent Exists',
            message: `The agent "${agentFileName}" already exists in your workspace. Do you want to overwrite it?`,
            buttons: ['Overwrite', 'Cancel'],
            defaultId: 1,
            cancelId: 1
        });

        if (result.response === 1) {
            return; // User cancelled
        }
    }

    try {
        // Create agents directory if it doesn't exist
        if (!existsSync(agentsDir)) {
            mkdirSync(agentsDir, { recursive: true });
        }

        // Copy the built-in agent file
        // In packaged app, resources are in app.asar or Resources folder
        let actualSourcePath: string;

        if (app.isPackaged) {
            // In packaged app, try multiple possible locations
            const possiblePaths = [
                // Resources folder next to app.asar
                join(process.resourcesPath, 'builtin-agents', agentFileName),
                // Inside app.asar (will work with asar support)
                join(__dirname, '..', '..', 'resources', 'builtin-agents', agentFileName),
                // macOS specific location
                join(process.resourcesPath, '..', 'Resources', 'builtin-agents', agentFileName),
            ];

            actualSourcePath = possiblePaths.find(p => existsSync(p)) || '';
        } else {
            // In development
            const devSourcePath = join(__dirname, '..', '..', '..', 'resources', 'builtin-agents', agentFileName);
            actualSourcePath = devSourcePath;
        }

        if (!actualSourcePath || !existsSync(actualSourcePath)) {
            throw new Error(`Built-in agent file not found: ${agentFileName}`);
        }

        copyFileSync(actualSourcePath, targetPath);

        dialog.showMessageBox(window, {
            type: 'info',
            title: 'Agent Installed',
            message: `The agent "${agentFileName}" has been successfully installed to your workspace.`,
            detail: `You can now use it by pressing Cmd+K to open the Agent Command Palette.`,
            buttons: ['OK']
        });

        // Trigger agent reload
        window.webContents.send('agents:updated', workspacePath);
    } catch (error) {
        dialog.showMessageBox(window, {
            type: 'error',
            title: 'Installation Failed',
            message: `Failed to install agent: ${error instanceof Error ? error.message : String(error)}`,
            buttons: ['OK']
        });
    }
}

// Create application menu
export async function createApplicationMenu() {
    // Get current theme from store
    const currentTheme = getTheme();
    const isDev = process.env.NODE_ENV !== 'production';

    const template: any[] = [
        {
            label: 'File',
            submenu: [
                {
                    id: 'file-new', // Add ID for dynamic updates
                    label: 'New',
                    accelerator: KeyboardShortcuts.file.new,
                    click: async () => {
                        const focusedWindow = getFocusedWindow();

                        if (focusedWindow) {
                            const windowId = getWindowId(focusedWindow);

                            if (windowId !== null) {
                                const state = windowStates.get(windowId);

                                if (state?.mode === 'workspace') {
                                    // In workspace mode, check activeMode to determine action
                                    const workspacePath = state.workspacePath;
                                    if (workspacePath) {
                                        const workspaceState = getWorkspaceState(workspacePath);
                                        const activeMode = workspaceState?.activeMode;

                                        if (activeMode === 'agent') {
                                            // In agent mode, create new AI session
                                            focusedWindow.webContents.send('agent-new-session');
                                        } else {
                                            // In files/plan mode, create new file
                                            focusedWindow.webContents.send('file-new-in-workspace');
                                        }
                                    } else {
                                        // No workspace path, default to new file
                                        focusedWindow.webContents.send('file-new-in-workspace');
                                    }
                                } else {
                                    // In document mode, create new window
                                    createWindow();
                                }
                            } else {
                                // Window not found in our map, create new window
                                createWindow();
                            }
                        } else {
                            // No focused window, create new window
                            createWindow();
                        }
                    }
                },
                {
                    label: 'New Mockup',
                    click: async () => {
                        const focusedWindow = getFocusedWindow();

                        if (focusedWindow) {
                            const windowId = getWindowId(focusedWindow);

                            if (windowId !== null) {
                                const state = windowStates.get(windowId);

                                if (state?.mode === 'workspace' && state.workspacePath) {
                                    // Send event to renderer to create a new mockup file
                                    focusedWindow.webContents.send('file-new-mockup', {
                                        workspacePath: state.workspacePath
                                    });
                                }
                            }
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open...',
                    accelerator: KeyboardShortcuts.file.open,
                    click: async () => {
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
                    }
                },
                {
                    label: 'Open Folder...',
                    accelerator: KeyboardShortcuts.file.openFolder,
                    click: async () => {
                        // Track menu action
                        AnalyticsService.getInstance().sendEvent('menu_action_used', {
                            menu: 'file',
                            action: 'open_folder',
                            hasKeyboardEquivalent: true,
                        });

                        const result = await dialog.showOpenDialog({
                            properties: ['openDirectory']
                        });

                        if (!result.canceled && result.filePaths.length > 0) {
                            const workspacePath = result.filePaths[0];
                            // Add to recent.workspaces
                            addToRecentItems('workspaces', workspacePath, basename(workspacePath));

                            // Check for saved workspace window state
                            const savedState = getWorkspaceWindowState(workspacePath);

                            // Create window with saved bounds if available
                            const window = createWindow(false, true, workspacePath, savedState?.bounds);

                            // Restore dev tools if they were open
                            if (savedState?.devToolsOpen) {
                                window.webContents.once('did-finish-load', () => {
                                    window.webContents.openDevTools();
                                });
                            }
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Recent Files',
                    submenu: await createRecentSubmenu()
                },
                ...(process.platform !== 'darwin' ? [
                  {
                      label: 'Settings...',
                      accelerator: KeyboardShortcuts.window.aiModels,
                      click: async () => {
                          // Track settings opened
                          AnalyticsService.getInstance().sendEvent('global_settings_opened', {
                              source: 'menu',
                              section: 'general',
                          });
                          // Switch to settings mode in the focused window
                          const focused = getFocusedWindow();
                          if (focused && !isAboutWindow(focused)) {
                              focused.webContents.send('set-content-mode', 'settings');
                          }
                      }
                  },
                ]: []),
                { type: 'separator' },
                {
                    label: 'Save',
                    accelerator: KeyboardShortcuts.file.save,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused && !isAboutWindow(focused)) {
                            focused.webContents.send('file-save');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Close Tab',
                    accelerator: KeyboardShortcuts.file.closeTab,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            const windowId = getWindowId(focused);
                            if (windowId !== null) {
                                const state = windowStates.get(windowId);

                                // If in workspace or agentic coding mode, close the active tab
                                if (state?.mode === 'workspace' || state?.mode === 'agentic-coding') {
                                    logger.menu.info(`[Close Tab] Sending close-active-tab to window ${windowId}`);
                                    focused.webContents.send('close-active-tab');
                                    return;
                                }
                            }

                            // Default behavior: close the window
                            focused.close();
                        } else {
                            logger.menu.warn('[Close Tab] No focused window found');
                        }
                    }
                },
                {
                    label: 'Reopen Closed Tab',
                    accelerator: KeyboardShortcuts.file.reopenClosedTab,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            const windowId = getWindowId(focused);
                            if (windowId !== null) {
                                const state = windowStates.get(windowId);

                                // Only works in workspace or agentic coding mode
                                if (state?.mode === 'workspace' || state?.mode === 'agentic-coding') {
                                    logger.menu.info(`[Reopen Closed Tab] Sending reopen-last-closed-tab to window ${windowId}`);
                                    focused.webContents.send('reopen-last-closed-tab');
                                } else {
                                    logger.menu.warn('[Reopen Closed Tab] Not in workspace/agentic mode');
                                }
                            }
                        } else {
                            logger.menu.warn('[Reopen Closed Tab] No focused window found');
                        }
                    }
                },
                {
                    label: 'Close Project',
                    accelerator: KeyboardShortcuts.file.closeProject,
                    click: async () => {
                        const focused = getFocusedWindow();

                        if (focused && !focused.isDestroyed()) {
                            // Get window info for logging
                            const windowId = getWindowId(focused);
                            const state = windowId !== null ? windowStates.get(windowId) : undefined;
                            let projectName = 'Untitled';

                            if (state?.mode === 'workspace' && state.workspacePath) {
                                projectName = basename(state.workspacePath);
                            } else if (state?.filePath) {
                                projectName = basename(state.filePath);
                            }

                            console.log('[Close Project] Closing:', {
                                windowId,
                                projectName,
                                mode: state?.mode,
                                electronId: focused.id
                            });

                            // TODO: Add warning dialog if AI/agent is running
                            focused.close();
                        } else {
                            console.error('[Close Project] No focused window found or window is destroyed');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: KeyboardShortcuts.file.quit,
                    click: async () => {
                        try {
                            console.log('Quit menu item clicked');
                            app.quit();
                        } catch (error) {
                            console.error('Error during quit:', error);
                            // Force quit if normal quit fails
                            process.exit(0);
                        }
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', accelerator: KeyboardShortcuts.edit.undo, role: 'undo' },
                { label: 'Redo', accelerator: KeyboardShortcuts.edit.redo, role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', accelerator: KeyboardShortcuts.edit.cut, role: 'cut' },
                { label: 'Copy', accelerator: KeyboardShortcuts.edit.copy, role: 'copy' },
                {
                    label: 'Copy as Markdown',
                    accelerator: KeyboardShortcuts.edit.copyMarkdown,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('copy-as-markdown');
                        }
                    }
                },
                { label: 'Paste', accelerator: KeyboardShortcuts.edit.paste, role: 'paste' },
                { label: 'Select All', accelerator: KeyboardShortcuts.edit.selectAll, role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Find...',
                    accelerator: KeyboardShortcuts.edit.find,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('menu:find');
                        }
                    }
                },
                {
                    label: 'Find Next',
                    accelerator: KeyboardShortcuts.edit.findNext,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('menu:find-next');
                        }
                    }
                },
                {
                    label: 'Find Previous',
                    accelerator: KeyboardShortcuts.edit.findPrevious,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('menu:find-previous');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'View Local History...',
                    accelerator: KeyboardShortcuts.edit.viewHistory,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('view-history');
                        }
                    }
                },
                {
                    label: 'View Folder History...',
                    accelerator: 'CmdOrCtrl+Shift+H',
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('view-workspace-history');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Approve Current Action',
                    accelerator: KeyboardShortcuts.edit.approve,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('approve-action');
                        }
                    }
                },
                {
                    label: 'Reject Current Action',
                    accelerator: KeyboardShortcuts.edit.reject,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('reject-action');
                        }
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                // View Modes
                {
                    label: 'Files Mode',
                    accelerator: KeyboardShortcuts.view.filesMode,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('set-content-mode', 'files');
                        }
                    }
                },
                {
                    label: 'Agent Mode',
                    accelerator: KeyboardShortcuts.view.agentMode,
                    click: async () => {
                        console.log('[Menu] Agent Mode clicked');
                        const focused = getFocusedWindow();
                        console.log('[Menu] Focused window:', focused ? 'exists' : 'null');
                        if (focused) {
                            console.log('[Menu] Sending set-content-mode event with agent');
                            focused.webContents.send('set-content-mode', 'agent');
                        }
                    }
                },
                { type: 'separator' },
                // Panels
                {
                    label: 'Toggle AI Chat Panel',
                    accelerator: KeyboardShortcuts.view.toggleAIChat,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('toggle-ai-chat-panel');
                        }
                    }
                },
                {
                    label: 'Toggle Bottom Panel',
                    accelerator: KeyboardShortcuts.view.toggleBottomPanel,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('toggle-bottom-panel');
                        }
                    }
                },
                { type: 'separator' },
                // Navigation
                {
                    label: 'Navigate Back',
                    accelerator: KeyboardShortcuts.view.navigateBack,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('navigation:go-back');
                        }
                    }
                },
                {
                    label: 'Navigate Forward',
                    accelerator: KeyboardShortcuts.view.navigateForward,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('navigation:go-forward');
                        }
                    }
                },
                { type: 'separator' },
                // Tab Navigation
                {
                    label: 'Next Tab',
                    accelerator: KeyboardShortcuts.view.nextTab,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('next-tab');
                        }
                    }
                },
                {
                    label: 'Previous Tab',
                    accelerator: KeyboardShortcuts.view.prevTab,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('previous-tab');
                        }
                    }
                },
                { type: 'separator' },
                // Zoom
                {
                    label: 'Actual Size',
                    accelerator: KeyboardShortcuts.view.actualSize,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) focused.webContents.setZoomFactor(1);
                    }
                },
                {
                    label: 'Zoom In',
                    accelerator: KeyboardShortcuts.view.zoomIn,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            const currentZoom = focused.webContents.getZoomFactor();
                            focused.webContents.setZoomFactor(currentZoom + 0.1);
                        }
                    }
                },
                {
                    label: 'Zoom Out',
                    accelerator: KeyboardShortcuts.view.zoomOut,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            const currentZoom = focused.webContents.getZoomFactor();
                            focused.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
                        }
                    }
                },
                { type: 'separator' },
                // Appearance
                {
                    label: 'Theme',
                    submenu: [
                        {
                            label: 'Light',
                            type: 'radio',
                            checked: currentTheme === 'light',
                            click: async () => {
                                const fromTheme = currentTheme;
                                const featureTracking = FeatureTrackingService.getInstance();
                                const isFirstChange = !featureTracking.hasBeenUsed('theme_changed' as any);

                                if (isFirstChange) {
                                    featureTracking.isFirstUse('theme_changed' as any);
                                }

                                setTheme('light');
                                updateNativeTheme();
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'light');
                                });
                                updateWindowTitleBars();
                                await createApplicationMenu();

                                // Track theme change
                                AnalyticsService.getInstance().sendEvent('theme_changed', {
                                    fromTheme,
                                    toTheme: 'light',
                                    isFirstChange,
                                });
                            }
                        },
                        {
                            label: 'Dark',
                            type: 'radio',
                            checked: currentTheme === 'dark',
                            click: async () => {
                                const fromTheme = currentTheme;
                                const featureTracking = FeatureTrackingService.getInstance();
                                const isFirstChange = !featureTracking.hasBeenUsed('theme_changed' as any);

                                if (isFirstChange) {
                                    featureTracking.isFirstUse('theme_changed' as any);
                                }

                                setTheme('dark');
                                updateNativeTheme();
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'dark');
                                });
                                updateWindowTitleBars();
                                await createApplicationMenu();

                                // Track theme change
                                AnalyticsService.getInstance().sendEvent('theme_changed', {
                                    fromTheme,
                                    toTheme: 'dark',
                                    isFirstChange,
                                });
                            }
                        },
                        {
                            label: 'Crystal Dark',
                            type: 'radio',
                            checked: currentTheme === 'crystal-dark',
                            click: async () => {
                                const fromTheme = currentTheme;
                                const featureTracking = FeatureTrackingService.getInstance();
                                const isFirstChange = !featureTracking.hasBeenUsed('theme_changed' as any);

                                if (isFirstChange) {
                                    featureTracking.isFirstUse('theme_changed' as any);
                                }

                                setTheme('crystal-dark');
                                updateNativeTheme();
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'crystal-dark');
                                });
                                updateWindowTitleBars();
                                await createApplicationMenu();

                                // Track theme change
                                AnalyticsService.getInstance().sendEvent('theme_changed', {
                                    fromTheme,
                                    toTheme: 'crystal-dark',
                                    isFirstChange,
                                });
                            }
                        },
                        {
                            label: 'System',
                            type: 'radio',
                            checked: currentTheme === 'system',
                            click: async () => {
                                const fromTheme = currentTheme;
                                const featureTracking = FeatureTrackingService.getInstance();
                                const isFirstChange = !featureTracking.hasBeenUsed('theme_changed' as any);

                                if (isFirstChange) {
                                    featureTracking.isFirstUse('theme_changed' as any);
                                }

                                setTheme('system');
                                updateNativeTheme();
                                // Send resolved theme (light or dark) to renderers
                                const resolvedTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', resolvedTheme);
                                });
                                updateWindowTitleBars();
                                await createApplicationMenu();

                                // Track theme change
                                AnalyticsService.getInstance().sendEvent('theme_changed', {
                                    fromTheme,
                                    toTheme: 'system',
                                    isFirstChange,
                                });
                            }
                        }
                    ]
                },
                { type: 'separator' },
                // Full screen
                {
                    label: 'Toggle Full Screen',
                    accelerator: KeyboardShortcuts.view.toggleFullScreen,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            focused.setFullScreen(!focused.isFullScreen());
                        }
                    }
                }
            ]
        },
        {
            label: 'Window',
            submenu: [
                {
                    label: 'Project Manager',
                    accelerator: KeyboardShortcuts.window.workspaceManager,
                    click: async () => {
                        // Track menu action
                        AnalyticsService.getInstance().sendEvent('menu_action_used', {
                            menu: 'window',
                            action: 'project_manager',
                            hasKeyboardEquivalent: true,
                        });
                        createWorkspaceManagerWindow();
                    }
                },
                {
                    label: 'AI Usage Report',
                    click: async () => {
                        // Track menu action
                        AnalyticsService.getInstance().sendEvent('menu_action_used', {
                            menu: 'window',
                            action: 'ai_usage_report',
                        });
                        createAIUsageReportWindow();
                    }
                },
                // {
                //     label: 'Session Manager',
                //     accelerator: KeyboardShortcuts.window.sessionManager,
                //     click: async () => {
                //         createSessionManagerWindow();
                //     }
                // },
                // {
                //     label: 'Agentic Coding...',
                //     accelerator: KeyboardShortcuts.window.agenticCoding,
                //     click: async () => {
                //         const focused = getFocusedWindow();
                //         if (!focused) return;
                //
                //         const windowId = getWindowId(focused);
                //         const state = windowId !== null ? windowStates.get(windowId) : undefined;
                //
                //         if (!state || !state.workspacePath) {
                //             dialog.showMessageBox(focused, {
                //                 type: 'info',
                //                 title: 'No Workspace',
                //                 message: 'Please open a workspace to use agentic coding.'
                //             });
                //             return;
                //         }
                //
                //         createAgenticCodingWindow({
                //             workspacePath: state.workspacePath,
                //             planDocumentPath: state.filePath && state.filePath.endsWith('.md') ? state.filePath : undefined
                //         });
                //     }
                // },
                { type: 'separator' },
                { label: 'Minimize', accelerator: KeyboardShortcuts.window.minimize, role: 'minimize' },
                { label: 'Close', role: 'close' },
                { type: 'separator' },
                { label: 'Bring All to Front', role: 'front' },
                { type: 'separator' },
                ...createWindowListMenu()
            ]
        },
        {
            label: 'Developer',
            submenu: [
                {
                    label: 'For assisting the development of Nimbalyst',
                    enabled: false
                },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: KeyboardShortcuts.view.toggleDevTools,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) focused.webContents.toggleDevTools();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: KeyboardShortcuts.view.reload,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) focused.webContents.reload();
                    }
                },
                {
                    label: 'Force Reload',
                    accelerator: KeyboardShortcuts.view.forceReload,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) focused.webContents.reloadIgnoringCache();
                    }
                },
                { type: 'separator' },
                {
                    label: 'File Watcher Status',
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            const status = getFileWatcherStatus(focused.id);
                            dialog.showMessageBox(focused, {
                                type: 'info',
                                title: 'File Watcher Status',
                                message: 'File Watcher Diagnostics',
                                detail: status,
                                buttons: ['OK']
                            });
                        }
                    }
                },
                {
                    label: 'Global Watcher Stats',
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            const stats = getGlobalFileWatcherStats();
                            dialog.showMessageBox(focused, {
                                type: 'info',
                                title: 'Global File Watcher Statistics',
                                message: 'File Watcher Performance & Statistics',
                                detail: stats,
                                buttons: ['OK']
                            });
                        }
                    }
                },
                {
                    label: 'Refresh File Tree',
                    accelerator: KeyboardShortcuts.developer.refreshFileTree,
                    click: async () => {
                        const focused = getFocusedWindow();
                        if (focused) {
                            refreshWorkspaceFileTree(focused);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Debug Log',
                    click: async () => {
                        const logPath = path.join(app.getPath('userData'), 'nimbalyst-debug.log');

                        // Create the log file if it doesn't exist
                        if (!fs.existsSync(logPath)) {
                            fs.writeFileSync(logPath, `=== Nimbalyst Debug Log ===\nNo debug messages yet.\n\nDebug logging is only active in development mode.\nTo enable debug logging in production, set NODE_ENV=development\n`);
                        }

                        shell.openPath(logPath).catch((err: any) => {
                            console.error('Failed to open debug log:', err);
                            dialog.showErrorBox('Error', `Could not open debug log at: ${logPath}`);
                        });
                    }
                },
                {
                    label: 'Open Main Log',
                    click: async () => {
                        const logPath = path.join(app.getPath('userData'), 'logs', 'main.log');

                        // Create the log file if it doesn't exist
                        if (!fs.existsSync(logPath)) {
                            const logsDir = path.dirname(logPath);
                            if (!fs.existsSync(logsDir)) {
                                fs.mkdirSync(logsDir, { recursive: true });
                            }
                            fs.writeFileSync(logPath, `=== Nimbalyst Main Log ===\nNo log messages yet.\n\nThis log contains main process and application logs.\n`);
                        }

                        shell.openPath(logPath).catch((err: any) => {
                            console.error('Failed to open main log:', err);
                            dialog.showErrorBox('Error', `Could not open main log at: ${logPath}`);
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Onboarding',
                    submenu: [
                        {
                            label: 'Show Onboarding',
                            click: async () => {
                                const focused = getFocusedWindow();
                                if (focused) {
                                    focused.webContents.send('show-feature-walkthrough');
                                }
                            }
                        },
                        {
                            label: 'Show Collection Form',
                            click: async () => {
                                const focused = getFocusedWindow();
                                if (focused) {
                                    focused.webContents.send('show-onboarding-dialog');
                                }
                            }
                        }
                    ]
                },
                ...(isDev ? [
                    { type: 'separator' },
                    {
                        label: 'Database Browser',
                        click: async () => {
                            createDatabaseBrowserWindow();
                        }
                    }
                ] : [])
            ]
        }
    ];

    // Add app menu on macOS
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.getName(),
            submenu: [
                {
                    label: 'About Nimbalyst',
                    click: async () => {
                        createAboutWindow();
                    }
                },
                {
                    label: 'Check for Updates...',
                    click: async () => {
                        autoUpdaterService.checkForUpdatesWithUI();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Settings...',
                    accelerator: KeyboardShortcuts.window.aiModels,
                    click: async () => {
                        // Track settings opened
                        AnalyticsService.getInstance().sendEvent('global_settings_opened', {
                            source: 'menu',
                            section: 'general',
                        });
                        // Switch to settings mode in the focused window
                        const focused = getFocusedWindow();
                        if (focused && !isAboutWindow(focused)) {
                            focused.webContents.send('set-content-mode', 'settings');
                        }
                    }
                },
                { type: 'separator' },
                { label: 'Services', submenu: [] },
                { type: 'separator' },
                { label: 'Hide ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
                { label: 'Hide Others', accelerator: 'Command+Shift+H', role: 'hideothers' },
                { label: 'Show All', role: 'unhide' },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: 'Command+Q',
                    click: async () => {
                        try {
                            console.log('Quit menu item clicked (macOS)');
                            app.quit();
                        } catch (error) {
                            console.error('Error during quit:', error);
                            // Force quit if normal quit fails
                            process.exit(0);
                        }
                    }
                }
            ]
        });

        // Add Help menu for macOS
        template.push({
            label: 'Help',
            submenu: [
                // {
                //     label: 'Welcome',
                //     click: async () => {
                //         // Track help accessed
                //         AnalyticsService.getInstance().sendEvent('help_accessed', {
                //             helpType: 'welcome',
                //             context: 'menu',
                //         });
                //         // Send message to renderer to open welcome tab
                //         const focusedWindow = getFocusedWindow();
                //         if (focusedWindow) {
                //             focusedWindow.webContents.send('open-welcome-tab');
                //         }
                //     }
                // },
                {
                    label: 'Documentation',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'docs',
                            context: 'menu',
                        });
                        shell.openExternal('https://docs.nimbalyst.com/');
                    }
                },
                {
                    label: 'Keyboard Shortcuts',
                    accelerator: 'CmdOrCtrl+/',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'keyboard_shortcuts',
                            context: 'menu',
                        });
                        const focusedWindow = getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('open-keyboard-shortcuts');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Join Discord Community',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'discord',
                            context: 'menu',
                        });
                        shell.openExternal('https://discord.gg/ubZDt4esEn');
                    }
                }
            ]
        });
    } else {
        // Windows and Linux
        template.push({
            label: 'Help',
            submenu: [
                {
                    label: 'Welcome',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'welcome',
                            context: 'menu',
                        });
                        // Send message to renderer to open welcome tab
                        const focusedWindow = getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('open-welcome-tab');
                        }
                    }
                },
                {
                    label: 'Documentation',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'docs',
                            context: 'menu',
                        });
                        shell.openExternal('https://docs.nimbalyst.com/');
                    }
                },
                {
                    label: 'Keyboard Shortcuts',
                    accelerator: 'CmdOrCtrl+/',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'keyboard_shortcuts',
                            context: 'menu',
                        });
                        const focusedWindow = getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('open-keyboard-shortcuts');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Join Discord Community',
                    click: async () => {
                        // Track help accessed
                        AnalyticsService.getInstance().sendEvent('help_accessed', {
                            helpType: 'discord',
                            context: 'menu',
                        });
                        shell.openExternal('https://discord.gg/ubZDt4esEn');
                    }
                },
                { type: 'separator' },
                {
                    label: 'About Nimbalyst',
                    click: async () => {
                        createAboutWindow();
                    }
                },
                {
                    label: 'Check for Updates...',
                    click: async () => {
                        autoUpdaterService.checkForUpdatesWithUI();
                    }
                }
            ]
        });
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Update application menu
export async function updateApplicationMenu() {
    try {
        await createApplicationMenu();
    } catch (error) {
        logger.menu.error('Error updating application menu:', error);
    }
}

// Helper to check if window is about window
function isAboutWindow(window: BrowserWindow): boolean {
    // Check if window is destroyed first
    if (!window || window.isDestroyed()) {
        return false;
    }
    // Check if this is the about window by checking the title
    return window.getTitle() === 'About Nimbalyst';
}

// Helper to check if window is workspace manager window
function isWorkspaceManagerWindow(window: BrowserWindow): boolean {
    // Check if window is destroyed first
    if (!window || window.isDestroyed()) {
        return false;
    }
    // Check if this is the workspace manager window by checking the title
    return window.getTitle() === 'Project Manager - Nimbalyst';
}


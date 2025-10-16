import { Menu, BrowserWindow, app, dialog, shell } from 'electron';
import { basename, join } from 'path';
import * as path from 'path';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import * as fs from 'fs';
import { windows, windowStates, createWindow, findWindowByFilePath, getWindowId } from '../window/WindowManager';
import { createAboutWindow } from '../window/AboutWindow';
import { createSessionManagerWindow } from '../window/SessionManagerWindow';
import { createWorkspaceManagerWindow } from '../window/WorkspaceManagerWindow.ts';
import { createAIModelsWindow } from '../window/AIModelsWindow';
import { createAgenticCodingWindow } from '../window/AgenticCodingWindow';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getRecentItems, clearRecentItems, addToRecentItems, getTheme, setTheme, store, getWorkspaceWindowState } from '../utils/store';
import { updateWindowTitleBars, updateNativeTheme } from '../theme/ThemeManager';
import { getFileWatcherStatus, refreshWorkspaceFileTree, getGlobalFileWatcherStats } from '../file/FileWatcherDebug';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';
import { autoUpdaterService } from '../services/autoUpdater';

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
            title = 'Workspace Manager';
            category = 'other';
        } else if (isSessionManagerWindow(window)) {
            title = 'Session Manager';
            category = 'other';
        } else if (isAIModelsWindow(window)) {
            title = 'AI Models';
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
        menuItems.push({ label: 'Open Workspaces', enabled: false });
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
        submenu.push({ label: 'Recent Workspaces', enabled: false });
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
                label: 'Clear Recent Workspaces',
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
                    label: 'New',
                    accelerator: 'CmdOrCtrl+N',
                    click: async () => {
                        console.log('[File->New] Menu clicked');
                        const focusedWindow = BrowserWindow.getFocusedWindow();
                        console.log('[File->New] Focused window:', focusedWindow ? `Electron ID: ${focusedWindow.id}` : 'none');

                        if (focusedWindow) {
                            // Find the custom window ID used by WindowManager
                            const windowId = getWindowId(focusedWindow);
                            console.log('[File->New] Custom window ID:', windowId);

                            if (windowId !== null) {
                                const state = windowStates.get(windowId);
                                console.log('[File->New] Window state:', state);

                                if (state?.mode === 'workspace') {
                                    // In workspace mode, send event to create new file in workspace
                                    console.log('[File->New] Workspace mode detected, sending file-new-in-workspace event');
                                    focusedWindow.webContents.send('file-new-in-workspace');
                                } else {
                                    // In document mode, create new window
                                    console.log('[File->New] Document mode or no mode, creating new window');
                                    createWindow();
                                }
                            } else {
                                // Window not found in our map, create new window
                                console.log('[File->New] ERROR: Window not found in windows Map!');
                                console.log('[File->New] Windows Map size:', windows.size);
                                console.log('[File->New] Creating new window as fallback');
                                createWindow();
                            }
                        } else {
                            // No focused window, create new window
                            console.log('[File->New] No focused window, creating new window');
                            createWindow();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open...',
                    accelerator: 'CmdOrCtrl+O',
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
                    accelerator: 'CmdOrCtrl+Shift+O',
                    click: async () => {
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
                {
                    label: 'Open Recent',
                    submenu: await createRecentSubmenu()
                },
                { type: 'separator' },
                {
                    label: 'Save',
                    accelerator: 'CmdOrCtrl+S',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused && !isAboutWindow(focused)) {
                            focused.webContents.send('file-save');
                        }
                    }
                },
                // {
                //     label: 'Save As',
                //     accelerator: 'CmdOrCtrl+Shift+S',
                //     click: async () => {
                //         const focused = BrowserWindow.getFocusedWindow();
                //         if (focused && !isAboutWindow(focused)) {
                //             focused.webContents.send('file-save-as');
                //         }
                //     }
                // },
                { type: 'separator' },
                {
                    label: 'Close',
                    accelerator: 'CmdOrCtrl+W',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.close();
                    }
                },
                {
                    label: 'Close Project',
                    accelerator: 'CmdOrCtrl+Shift+W',
                    enabled: (() => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (!focused) return false;
                        const windowId = getWindowId(focused);
                        if (windowId === null) return false;
                        const state = windowStates.get(windowId);
                        return state?.mode === 'workspace';
                    })(),
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            const windowId = getWindowId(focused);
                            if (windowId !== null) {
                                const state = windowStates.get(windowId);
                                if (state?.mode === 'workspace') {
                                    focused.close();
                                }
                            }
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
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
                { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
                { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'View History...',
                    accelerator: 'CmdOrCtrl+Y',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('view-history');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Next Tab',
                    accelerator: 'CmdOrCtrl+Alt+Right',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('next-tab');
                        }
                    }
                },
                {
                    label: 'Previous Tab',
                    accelerator: 'CmdOrCtrl+Alt+Left',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('previous-tab');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Approve',
                    accelerator: 'CmdOrCtrl+Enter',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('approve-action');
                        }
                    }
                },
                {
                    label: 'Reject',
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
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
                {
                    label: 'Navigate Back',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Alt+Left' : 'Ctrl+Alt+Left',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('navigation:go-back');
                        }
                    }
                },
                {
                    label: 'Navigate Forward',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Alt+Right' : 'Ctrl+Alt+Right',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('navigation:go-forward');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'All Plans',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('open-plans-tab');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Agents',
                    submenu: [
                        {
                            label: 'Open Agent Command Palette',
                            accelerator: 'CmdOrCtrl+K',
                            click: async () => {
                                const focused = BrowserWindow.getFocusedWindow();
                                if (focused) {
                                    focused.webContents.send('toggle-agent-palette');
                                }
                            }
                        },
                        { type: 'separator' },
                        {
                            label: 'Install Built-in Agents',
                            submenu: [
                                {
                                    label: 'Plan Document Manager',
                                    click: async () => {
                                        const focused = BrowserWindow.getFocusedWindow();
                                        if (focused) {
                                            await installBuiltinAgent(focused, 'plan-document-manager.md');
                                        }
                                    }
                                },
                                {
                                    label: 'Security Quick Scan',
                                    click: async () => {
                                        const focused = BrowserWindow.getFocusedWindow();
                                        if (focused) {
                                            await installBuiltinAgent(focused, 'security-quick-scan.md');
                                        }
                                    }
                                },
                                {
                                    label: 'User Documentation Writer',
                                    click: async () => {
                                        const focused = BrowserWindow.getFocusedWindow();
                                        if (focused) {
                                            await installBuiltinAgent(focused, 'documentation-writer.md');
                                        }
                                    }
                                },
                                { type: 'separator' },
                                {
                                    label: '[TEST] Document Creator',
                                    click: async () => {
                                        const focused = BrowserWindow.getFocusedWindow();
                                        if (focused) {
                                            await installBuiltinAgent(focused, 'test-document-creator.md');
                                        }
                                    }
                                }
                            ]
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.toggleDevTools();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.reload();
                    }
                },
                {
                    label: 'Force Reload',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.reloadIgnoringCache();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Actual Size',
                    accelerator: 'CmdOrCtrl+0',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.setZoomFactor(1);
                    }
                },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            const currentZoom = focused.webContents.getZoomFactor();
                            focused.webContents.setZoomFactor(currentZoom + 0.1);
                        }
                    }
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            const currentZoom = focused.webContents.getZoomFactor();
                            focused.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
                        }
                    }
                }
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
                            click: async () => {
                                setTheme('light');
                                updateNativeTheme();
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'light');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                await createApplicationMenu();
                            }
                        },
                        {
                            label: 'Dark',
                            type: 'radio',
                            checked: currentTheme === 'dark',
                            click: async () => {
                                setTheme('dark');
                                updateNativeTheme();
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'dark');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                await createApplicationMenu();
                            }
                        },
                        {
                            label: 'Crystal Dark',
                            type: 'radio',
                            checked: currentTheme === 'crystal-dark',
                            click: async () => {
                                setTheme('crystal-dark');
                                updateNativeTheme();
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'crystal-dark');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                await createApplicationMenu();
                            }
                        },
                        {
                            label: 'System',
                            type: 'radio',
                            checked: currentTheme === 'system',
                            click: async () => {
                                setTheme('system');
                                updateNativeTheme();
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'system');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                await createApplicationMenu();
                            }
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Workspace Manager',
                    accelerator: 'CmdOrCtrl+P',
                    click: async () => {
                        createWorkspaceManagerWindow();
                    }
                },
                {
                    label: 'Session Manager',
                    accelerator: 'CmdOrCtrl+Alt+S',
                    click: async () => {
                        createSessionManagerWindow();
                    }
                },
                {
                    label: 'AI Models...',
                    accelerator: 'CmdOrCtrl+Alt+M',
                    click: async () => {
                        createAIModelsWindow();
                    }
                },
                {
                    label: 'Agentic Coding...',
                    accelerator: 'CmdOrCtrl+Alt+A',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (!focused) return;

                        const windowId = getWindowId(focused);
                        const state = windowId !== null ? windowStates.get(windowId) : undefined;

                        if (!state || !state.workspacePath) {
                            dialog.showMessageBox(focused, {
                                type: 'info',
                                title: 'No Workspace',
                                message: 'Please open a workspace to use agentic coding.'
                            });
                            return;
                        }

                        createAgenticCodingWindow({
                            workspacePath: state.workspacePath,
                            planDocumentPath: state.filePath && state.filePath.endsWith('.md') ? state.filePath : undefined
                        });
                    }
                },
                { type: 'separator' },
                { label: 'Minimize', role: 'minimize' },
                { label: 'Close', role: 'close' },
                { type: 'separator' },
                ...createWindowListMenu()
            ]
        },
        {
            label: 'Debug',
            submenu: [
                {
                    label: 'Show File Watcher Status',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
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
                    label: 'Show Global Watcher Stats',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
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
                    accelerator: 'CmdOrCtrl+Shift+F5',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            refreshWorkspaceFileTree(focused);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Debug Log',
                    click: async () => {
                        const logPath = path.join(app.getPath('userData'), 'preditor-debug.log');

                        // Create the log file if it doesn't exist
                        if (!fs.existsSync(logPath)) {
                            fs.writeFileSync(logPath, `=== Preditor Debug Log ===\nNo debug messages yet.\n\nDebug logging is only active in development mode.\nTo enable debug logging in production, set NODE_ENV=development\n`);
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
                            fs.writeFileSync(logPath, `=== Preditor Main Log ===\nNo log messages yet.\n\nThis log contains main process and application logs.\n`);
                        }

                        shell.openPath(logPath).catch((err: any) => {
                            console.error('Failed to open main log:', err);
                            dialog.showErrorBox('Error', `Could not open main log at: ${logPath}`);
                        });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Toggle Debug Console',
                    accelerator: 'CmdOrCtrl+Shift+D',
                    click: async () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('toggle-debug-console');
                        }
                    }
                },
                // Database menu items - only show in development mode
                ...(isDev ? [
                    { type: 'separator' },
                    {
                        label: 'Start Database Server',
                        click: async () => {
                            try {
                                const { database } = await import('../database/initialize');
                                const result = await database.startProtocolServer();

                            const focused = BrowserWindow.getFocusedWindow();
                            if (focused) {
                                dialog.showMessageBox(focused, {
                                    type: 'info',
                                    title: 'Database Server Started',
                                    message: result.message || 'Database server started successfully',
                                    detail: `You can now connect using:\npsql -h ${result.host} -p ${result.port} -d pglite\n\nOr use any PostgreSQL client like pgAdmin, DataGrip, or TablePlus.\n\nNote: Only one connection at a time is supported.`,
                                    buttons: ['OK']
                                });
                            }
                        } catch (error) {
                            const focused = BrowserWindow.getFocusedWindow();
                            if (focused) {
                                dialog.showMessageBox(focused, {
                                    type: 'error',
                                    title: 'Failed to Start Database Server',
                                    message: error instanceof Error ? error.message : 'Failed to start database server',
                                    buttons: ['OK']
                                });
                            }
                        }
                    }
                },
                {
                    label: 'Stop Database Server',
                    click: async () => {
                        try {
                            const { database } = await import('../database/initialize');
                            const result = await database.stopProtocolServer();

                            const focused = BrowserWindow.getFocusedWindow();
                            if (focused) {
                                dialog.showMessageBox(focused, {
                                    type: 'info',
                                    title: 'Database Server Stopped',
                                    message: result.message || 'Database server stopped',
                                    buttons: ['OK']
                                });
                            }
                        } catch (error) {
                            const focused = BrowserWindow.getFocusedWindow();
                            if (focused) {
                                dialog.showMessageBox(focused, {
                                    type: 'error',
                                    title: 'Error',
                                    message: error instanceof Error ? error.message : 'Failed to stop database server',
                                    buttons: ['OK']
                                });
                            }
                        }
                    }
                },
                {
                    label: 'Database Connection Info',
                    click: async () => {
                        try {
                            const { database } = await import('../database/initialize');
                            const status = await database.getProtocolServerStatus();

                            const focused = BrowserWindow.getFocusedWindow();
                            if (focused) {
                                if (status.running) {
                                    const connectionString = `postgresql://${status.host}:${status.port}/pglite`;
                                    dialog.showMessageBox(focused, {
                                        type: 'info',
                                        title: 'Database Connection Info',
                                        message: 'PostgreSQL Protocol Server',
                                        detail: `The database server is running and accepting connections.

Connection Details:
Host: ${status.host}
Port: ${status.port}
Database: pglite

Connection String:
${connectionString}

You can connect using any PostgreSQL client:
• psql -h ${status.host} -p ${status.port} -d pglite
• pgAdmin, DataGrip, TablePlus, etc.

Note: Only one connection at a time is supported.`,
                                        buttons: ['OK']
                                    });
                                } else {
                                    dialog.showMessageBox(focused, {
                                        type: 'info',
                                        title: 'Database Server Not Running',
                                        message: 'The PostgreSQL protocol server is not running.',
                                        detail: 'Start the server from Debug > Start Database Server first.',
                                        buttons: ['OK']
                                    });
                                }
                            }
                        } catch (error) {
                            const focused = BrowserWindow.getFocusedWindow();
                            if (focused) {
                                dialog.showMessageBox(focused, {
                                    type: 'error',
                                    title: 'Error',
                                    message: error instanceof Error ? error.message : 'Failed to get server status',
                                    buttons: ['OK']
                                });
                            }
                        }
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
                    label: 'About Preditor',
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
                    accelerator: 'CmdOrCtrl+,',
                    click: async () => {
                        createAIModelsWindow();

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
                {
                    label: 'Welcome',
                    click: async () => {
                        // Send message to renderer to open welcome tab
                        const focusedWindow = BrowserWindow.getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('open-welcome-tab');
                        }
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
                        // Send message to renderer to open welcome tab
                        const focusedWindow = BrowserWindow.getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('open-welcome-tab');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'About Preditor',
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
    return window.getTitle() === 'About Preditor';
}

// Helper to check if window is workspace manager window
function isWorkspaceManagerWindow(window: BrowserWindow): boolean {
    // Check if window is destroyed first
    if (!window || window.isDestroyed()) {
        return false;
    }
    // Check if this is the workspace manager window by checking the title
    return window.getTitle() === 'Workspace Manager - Preditor';
}

// Helper to check if window is session manager window
function isSessionManagerWindow(window: BrowserWindow): boolean {
    // Check if window is destroyed first
    if (!window || window.isDestroyed()) {
        return false;
    }
    // Check if this is the session manager window by checking the title
    return window.getTitle() === 'AI Chat Sessions - All Workspaces';
}

// Helper to check if window is AI models window
function isAIModelsWindow(window: BrowserWindow): boolean {
    // Check if window is destroyed first
    if (!window || window.isDestroyed()) {
        return false;
    }
    // Check if this is the AI models window by checking the title
    return window.getTitle() === 'AI Models';
}

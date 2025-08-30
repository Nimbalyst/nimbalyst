import { Menu, BrowserWindow, app, dialog } from 'electron';
import { basename } from 'path';
import { existsSync } from 'fs';
import { windows, windowStates, createWindow, findWindowByFilePath } from '../window/WindowManager';
import { createAboutWindow } from '../window/AboutWindow';
import { createSessionManagerWindow } from '../window/SessionManagerWindow';
import { createProjectManagerWindow } from '../window/ProjectManagerWindow';
import { createAIModelsWindow } from '../window/AIModelsWindow';
import { loadFileIntoWindow } from '../file/FileOperations';
import { getRecentItems, clearRecentItems, addToRecentItems, getTheme, setTheme, store, getProjectWindowState } from '../utils/store';
import { updateWindowTitleBars } from '../theme/ThemeManager';
import { getFileWatcherStatus, refreshProjectFileTree } from '../file/FileWatcherDebug';
import { getFolderContents } from '../utils/FileTree';
import { logger } from '../utils/logger';

// Create window list menu items
function createWindowListMenu(): any[] {
    const menuItems: any[] = [];
    const allWindows = BrowserWindow.getAllWindows();

    if (allWindows.length === 0) {
        return [];
    }

    // Categorize windows
    const projectWindows: { window: BrowserWindow; title: string }[] = [];
    const documentWindows: { window: BrowserWindow; title: string }[] = [];
    const otherWindows: { window: BrowserWindow; title: string }[] = [];

    allWindows.forEach((window) => {
        const windowId = window.id;
        const state = windowStates.get(windowId);
        let title = 'Untitled';
        let category: 'project' | 'document' | 'other' = 'document';

        // Check for special windows first
        if (isProjectManagerWindow(window)) {
            title = 'Project Manager';
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
            if (state.mode === 'project' && state.projectPath) {
                const projectName = basename(state.projectPath);
                if (state.filePath) {
                    const fileName = basename(state.filePath);
                    title = `${fileName} - ${projectName}`;
                } else {
                    title = projectName;
                }
                category = 'project';
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
        if (category === 'project') {
            projectWindows.push({ window, title });
        } else if (category === 'document') {
            documentWindows.push({ window, title });
        } else {
            otherWindows.push({ window, title });
        }
    });

    // Build menu items with groups
    let shortcutIndex = 0;

    // Add project windows
    if (projectWindows.length > 0) {
        if (menuItems.length > 0) {
            menuItems.push({ type: 'separator' });
        }
        menuItems.push({ label: 'Open Projects', enabled: false });
        projectWindows.forEach(({ window, title }) => {
            const accelerator = shortcutIndex < 9 ? `CmdOrCtrl+${shortcutIndex + 1}` : undefined;
            shortcutIndex++;
            menuItems.push({
                label: title,
                accelerator,
                type: 'checkbox',
                checked: window.isFocused(),
                click: () => {
                    window.focus();
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
                checked: window.isFocused(),
                click: () => {
                    window.focus();
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
    //             click: () => {
    //                 window.focus();
    //             }
    //         });
    //     });
    // }

    return menuItems;
}

// Create the recent submenu
function createRecentSubmenu(): any[] {
    const recentProjects = getRecentItems('projects');
    const recentDocuments = getRecentItems('documents');
    const submenu: any[] = [];

    // Recent Projects section
    if (recentProjects.length > 0) {
        submenu.push({ label: 'Recent Projects', enabled: false });
        recentProjects.forEach(project => {
            submenu.push({
                label: project.name,
                click: () => {
                    // Check if project exists
                    if (existsSync(project.path)) {
                        // Check for saved project window state
                        const savedState = getProjectWindowState(project.path);

                        // Create window with saved bounds if available
                        const window = createWindow(false, true, project.path, savedState?.bounds);

                        // Restore dev tools if they were open
                        if (savedState?.devToolsOpen) {
                            window.webContents.once('did-finish-load', () => {
                                window.webContents.openDevTools();
                            });
                        }
                    } else {
                        // Remove from recent if doesn't exist
                        const items = getRecentItems('projects').filter(item => item.path !== project.path);
                        store.set('recent.projects', items);
                        updateApplicationMenu();
                        dialog.showErrorBox('Project Not Found', `The project "${project.name}" could not be found at:\n${project.path}`);
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
                click: () => {
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
    if (recentProjects.length > 0 || recentDocuments.length > 0) {
        submenu.push({ type: 'separator' });

        if (recentProjects.length > 0) {
            submenu.push({
                label: 'Clear Recent Projects',
                click: () => {
                    clearRecentItems('projects');
                    updateApplicationMenu();
                }
            });
        }

        if (recentDocuments.length > 0) {
            submenu.push({
                label: 'Clear Recent Documents',
                click: () => {
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

// Create application menu
export function createApplicationMenu() {
    // Get current theme from store
    const currentTheme = getTheme();

    const template: any[] = [
        {
            label: 'File',
            submenu: [
                { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
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
                            const projectPath = result.filePaths[0];
                            // Add to recent projects
                            addToRecentItems('projects', projectPath, basename(projectPath));

                            // Check for saved project window state
                            const savedState = getProjectWindowState(projectPath);

                            // Create window with saved bounds if available
                            const window = createWindow(false, true, projectPath, savedState?.bounds);

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
                    submenu: createRecentSubmenu()
                },
                { type: 'separator' },
                {
                    label: 'Save',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused && !isAboutWindow(focused)) {
                            focused.webContents.send('file-save');
                        }
                    }
                },
                // {
                //     label: 'Save As',
                //     accelerator: 'CmdOrCtrl+Shift+S',
                //     click: () => {
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
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.close();
                    }
                },
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
                { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
                { type: 'separator' },
                {
                    label: 'View History...',
                    accelerator: 'CmdOrCtrl+Y',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('view-history');
                        }
                    }
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.toggleDevTools();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.reload();
                    }
                },
                {
                    label: 'Force Reload',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.reloadIgnoringCache();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Actual Size',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) focused.webContents.setZoomFactor(1);
                    }
                },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => {
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
                    click: () => {
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
                            click: () => {
                                setTheme('light');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'light');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        },
                        {
                            label: 'Dark',
                            type: 'radio',
                            checked: currentTheme === 'dark',
                            click: () => {
                                setTheme('dark');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'dark');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        },
                        {
                            label: 'Crystal Dark',
                            type: 'radio',
                            checked: currentTheme === 'crystal-dark',
                            click: () => {
                                setTheme('crystal-dark');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'crystal-dark');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        },
                        {
                            label: 'System',
                            type: 'radio',
                            checked: currentTheme === 'system',
                            click: () => {
                                setTheme('system');
                                // Send to all windows
                                BrowserWindow.getAllWindows().forEach(window => {
                                    window.webContents.send('theme-change', 'system');
                                });
                                // Update window title bars
                                updateWindowTitleBars();
                                // Recreate menu to update checkmarks
                                createApplicationMenu();
                            }
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Project Manager',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => {
                        createProjectManagerWindow();
                    }
                },
                {
                    label: 'Session Manager',
                    accelerator: 'CmdOrCtrl+Alt+S',
                    click: () => {
                        createSessionManagerWindow();
                    }
                },
                {
                    label: 'AI Models...',
                    accelerator: 'CmdOrCtrl+Alt+M',
                    click: () => {
                        createAIModelsWindow();
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
                    click: () => {
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
                    label: 'Refresh File Tree',
                    accelerator: 'CmdOrCtrl+Shift+F5',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            refreshProjectFileTree(focused);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Debug Log',
                    click: () => {
                        const logPath = app.getPath('userData') + '/stravu-editor-debug.log';
                        require('electron').shell.openPath(logPath);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Toggle Debug Console',
                    accelerator: 'CmdOrCtrl+Shift+D',
                    click: () => {
                        const focused = BrowserWindow.getFocusedWindow();
                        if (focused) {
                            focused.webContents.send('toggle-debug-console');
                        }
                    }
                }
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
                        createAboutWindow();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Preferences...',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        const focusedWindow = BrowserWindow.getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('show-preferences');
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
                        createAboutWindow();
                    }
                }
            ]
        });
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Update application menu
export function updateApplicationMenu() {
    try {
        createApplicationMenu();
    } catch (error) {
        logger.menu.error('Error updating application menu:', error);
    }
}

// Helper to check if window is about window
function isAboutWindow(window: BrowserWindow): boolean {
    // Check if this is the about window by checking the title
    return window.getTitle() === 'About Stravu Editor';
}

// Helper to check if window is project manager window
function isProjectManagerWindow(window: BrowserWindow): boolean {
    // Check if this is the project manager window by checking the title
    return window.getTitle() === 'Project Manager - Stravu Editor';
}

// Helper to check if window is session manager window
function isSessionManagerWindow(window: BrowserWindow): boolean {
    // Check if this is the session manager window by checking the title
    return window.getTitle() === 'AI Chat Sessions - All Projects';
}

// Helper to check if window is AI models window
function isAIModelsWindow(window: BrowserWindow): boolean {
    // Check if this is the AI models window by checking the title
    return window.getTitle() === 'AI Models';
}

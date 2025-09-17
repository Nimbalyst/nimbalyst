import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { join, basename } from 'path';
import { existsSync, mkdirSync, statSync, readdirSync } from 'fs';
import { getRecentItems, addToRecentItems, store, getWorkspaceWindowState } from '../utils/store';
import { createWindow } from './WindowManager';

let workspaceManagerWindow: BrowserWindow | null = null;

export function createWorkspaceManagerWindow() {
  // If window already exists, check if it's healthy
  if (workspaceManagerWindow && !workspaceManagerWindow.isDestroyed()) {
    // Check if the window content is corrupted
    workspaceManagerWindow.webContents.executeJavaScript(`
      document.body && document.body.textContent && document.body.textContent.length > 0
    `).then(isHealthy => {
      if (isHealthy) {
        workspaceManagerWindow?.focus();
      } else {
        // Window content is corrupted, recreate it
        console.warn('[WorkspaceManager] Window content corrupted, recreating window');
        workspaceManagerWindow?.destroy();
        workspaceManagerWindow = null;
        createWorkspaceManagerWindow();
      }
    }).catch(() => {
      // Error checking health, recreate window
      console.warn('[WorkspaceManager] Error checking window health, recreating window');
      workspaceManagerWindow?.destroy();
      workspaceManagerWindow = null;
      createWorkspaceManagerWindow();
    });
    return workspaceManagerWindow;
  }

  // Create the window
  workspaceManagerWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    title: 'Workspace Manager - Preditor',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: false
    },
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 10, y: 10 },
    vibrancy: 'sidebar',
    backgroundColor: '#1e1e1e'
  });

  // Load the main app with a query parameter to indicate Workspace Manager mode
  const loadContent = () => {
    if (process.env.NODE_ENV === 'development') {
      return workspaceManagerWindow!.loadURL('http://localhost:5273/?mode=workspace-manager');
    } else {
      return workspaceManagerWindow!.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { mode: 'workspace-manager' }
      });
    }
  };

  loadContent().catch(err => {
    console.error('[WorkspaceManager] Failed to load window content:', err);
    // Try to reload once
    setTimeout(() => {
      if (workspaceManagerWindow && !workspaceManagerWindow.isDestroyed()) {
        loadContent().catch(err2 => {
          console.error('[WorkspaceManager] Failed to reload window content:', err2);
        });
      }
    }, 1000);
  });

  // Show window when ready
  workspaceManagerWindow.once('ready-to-show', () => {
    workspaceManagerWindow?.show();
  });

  // Handle renderer process crashes
  workspaceManagerWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[WorkspaceManager] Renderer process gone:', details);
    if (workspaceManagerWindow && !workspaceManagerWindow.isDestroyed()) {
      // Reload the window
      workspaceManagerWindow.reload();
    }
  });

  // Handle unresponsive renderer
  workspaceManagerWindow.webContents.on('unresponsive', () => {
    console.warn('[WorkspaceManager] Window became unresponsive');
    const choice = dialog.showMessageBoxSync(workspaceManagerWindow!, {
      type: 'warning',
      buttons: ['Reload', 'Keep Waiting'],
      defaultId: 0,
      message: 'Workspace Manager is not responding',
      detail: 'Would you like to reload the window?'
    });

    if (choice === 0 && workspaceManagerWindow && !workspaceManagerWindow.isDestroyed()) {
      workspaceManagerWindow.reload();
    }
  });

  // Handle responsive again
  workspaceManagerWindow.webContents.on('responsive', () => {
    console.log('[WorkspaceManager] Window became responsive again');
  });

  // Clean up when closed
  workspaceManagerWindow.on('closed', () => {
    workspaceManagerWindow = null;
  });

  return workspaceManagerWindow;
}

// Setup handlers once when module loads
let handlersRegistered = false;

export function setupWorkspaceManagerHandlers() {
  // Only register handlers once
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;
  // Get recent workspaces with additional info
  ipcMain.handle('workspace-manager:get-recent-workspaces', async () => {
    const recentWorkspaces = await getRecentItems('workspaces');

    // Add additional info for each workspace
    const workspacesWithInfo = recentWorkspaces.map(workspace => {
      try {
        if (existsSync(workspace.path)) {
          const stats = statSync(workspace.path);
          const files = getWorkspaceFiles(workspace.path);

          return {
            ...workspace,
            lastOpened: workspace.timestamp, // Use the timestamp from the recent items
            lastModified: stats.mtime.getTime(),
            fileCount: files.length,
            markdownCount: files.filter(f => f.endsWith('.md') || f.endsWith('.markdown')).length,
            exists: true
          };
        }
      } catch (error) {
        console.error('Error getting workspace info:', error);
      }

      return {
        ...workspace,
        lastOpened: workspace.timestamp || Date.now(), // Fallback to now if no timestamp
        exists: false
      };
    }).filter(w => w.exists);

    return workspacesWithInfo;
  });

  // Get workspace statistics
  ipcMain.handle('workspace-manager:get-workspace-stats', async (event, workspacePath: string) => {
    try {
      const files = getWorkspaceFiles(workspacePath);
      let totalSize = 0;
      const markdownFiles = [];

      for (const file of files) {
        try {
          const filePath = join(workspacePath, file);
          const stats = statSync(filePath);
          totalSize += stats.size;

          if (file.endsWith('.md') || file.endsWith('.markdown')) {
            markdownFiles.push(file);
          }
        } catch (error) {
          // Ignore files we can't stat
        }
      }

      // Get recent files for this workspace
      const recentFiles = store.get(`workspaceRecentFiles.${workspacePath}`, []) as string[];

      return {
        fileCount: files.length,
        markdownCount: markdownFiles.length,
        totalSize,
        recentFiles: recentFiles.slice(0, 5)
      };
    } catch (error) {
      console.error('Failed to get workspace stats:', error);
      return {
        fileCount: 0,
        markdownCount: 0,
        totalSize: 0,
        recentFiles: []
      };
    }
  });

  // Open folder dialog
  ipcMain.handle('workspace-manager:open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }

    return { success: false };
  });

  // Create workspace dialog
  ipcMain.handle('workspace-manager:create-workspace-dialog', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Create New Workspace',
      buttonLabel: 'Create',
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });

    if (!result.canceled && result.filePath) {
      try {
        // Create the directory if it doesn't exist
        if (!existsSync(result.filePath)) {
          mkdirSync(result.filePath, { recursive: true });
        }

        // Create a README.md file
        const fs = require('fs');
        const readmePath = join(result.filePath, 'README.md');
        if (!existsSync(readmePath)) {
          fs.writeFileSync(readmePath, `# ${basename(result.filePath)}\n\nWelcome to your new workspace!\n`);
        }

        return { success: true, path: result.filePath };
      } catch (error) {
        console.error('Failed to create workspace:', error);
        return { success: false, error: error.message };
      }
    }

    return { success: false };
  });

  // Open workspace (always in new window)
  ipcMain.handle('workspace-manager:open-workspace', async (event, workspacePath: string) => {
    // Add to recent workspaces
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

    // Disable single file restoration - we now use tab restoration instead
    // if (savedState?.filePath && existsSync(savedState.filePath)) {
    //   window.webContents.once('did-finish-load', () => {
    //     // Give the renderer time to initialize
    //     setTimeout(() => {
    //       window.webContents.send('open-workspace-file', savedState.filePath);
    //     }, 500);
    //   });
    // }

    // Close workspace manager after opening workspace
    if (workspaceManagerWindow && !workspaceManagerWindow.isDestroyed()) {
      workspaceManagerWindow.close();
    }

    return { success: true };
  });

  // Remove from recent.workspaces
  ipcMain.handle('workspace-manager:remove-recent', async (event, workspacePath: string) => {
    const items = (await getRecentItems('workspaces')).filter(item => item.path !== workspacePath);
    store.set('recent.workspaces', items);
    return { success: true };
  });
}

// Helper function to get all files in a workspace
function getWorkspaceFiles(workspacePath: string, relativePath: string = ''): string[] {
  const files: string[] = [];
  const fullPath = join(workspacePath, relativePath);

  try {
    const items = readdirSync(fullPath);

    for (const item of items) {
      // Skip hidden files and common ignore patterns
      if (item.startsWith('.') || item === 'node_modules' || item === 'dist' || item === 'out') {
        continue;
      }

      const itemPath = join(relativePath, item);
      const fullItemPath = join(workspacePath, itemPath);
      const stats = statSync(fullItemPath);

      if (stats.isDirectory()) {
        files.push(...getWorkspaceFiles(workspacePath, itemPath));
      } else {
        files.push(itemPath);
      }
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }

  return files;
}

export function closeWorkspaceManagerWindow() {
  if (workspaceManagerWindow && !workspaceManagerWindow.isDestroyed()) {
    workspaceManagerWindow.close();
  }
}

export function isWorkspaceManagerOpen(): boolean {
  return workspaceManagerWindow !== null && !workspaceManagerWindow.isDestroyed();
}

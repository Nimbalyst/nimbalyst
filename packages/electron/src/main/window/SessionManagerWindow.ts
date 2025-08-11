import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { join } from 'path';
import { writeFileSync } from 'fs';
import Store from 'electron-store';
import { getTheme } from '../utils/store';
import { getTitleBarColors } from '../theme/ThemeManager';

let sessionManagerWindow: BrowserWindow | null = null;

export function createSessionManagerWindow(filterProject?: string) {
  // If window already exists, focus it
  if (sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
    sessionManagerWindow.focus();
    // Send filter update if provided
    if (filterProject) {
      sessionManagerWindow.webContents.send('filter-project', filterProject);
    }
    return;
  }

  // Create the window
  sessionManagerWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'AI Chat Sessions - All Projects',
    backgroundColor: getTheme() === 'dark' || getTheme() === 'crystal-dark' ? '#1e1e1e' : '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true
    },
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform !== 'darwin' ? getTitleBarColors() : false,
  });

  // Load the HTML file
  if (process.env.NODE_ENV === 'development') {
    sessionManagerWindow.loadFile(join(__dirname, '../../src/session-manager/index.html'));
  } else {
    sessionManagerWindow.loadFile(join(__dirname, '../session-manager/index.html'));
  }

  // Show window when ready
  sessionManagerWindow.once('ready-to-show', () => {
    sessionManagerWindow?.show();
    // Send filter if provided
    if (filterProject) {
      sessionManagerWindow?.webContents.send('filter-project', filterProject);
    }
  });

  // Clean up when closed
  sessionManagerWindow.on('closed', () => {
    sessionManagerWindow = null;
  });
}

export function registerSessionManagerHandlers() {
  // Get all sessions from all projects
  ipcMain.handle('session-manager:get-all-sessions', async () => {
    const store = new Store({ name: 'claude-sessions' });
    const sessionsByProject = store.get('sessionsByProject', {}) as Record<string, any[]>;
    
    // Flatten all sessions from all projects
    const allSessions: any[] = [];
    for (const [projectPath, sessions] of Object.entries(sessionsByProject)) {
      sessions.forEach(session => {
        allSessions.push({
          ...session,
          projectPath: projectPath === 'default' ? null : projectPath
        });
      });
    }
    
    // Sort by timestamp descending (newest first)
    allSessions.sort((a, b) => b.timestamp - a.timestamp);
    
    return allSessions;
  });

  // Open a session
  ipcMain.handle('session-manager:open-session', async (event, sessionId: string, projectPath?: string) => {
    // Find or create a window
    const windows = BrowserWindow.getAllWindows().filter(w => w !== sessionManagerWindow);
    let targetWindow = windows.find(w => !w.isDestroyed());
    
    if (!targetWindow) {
      // Create a new window if none exists
      const { createWindow } = require('../window/WindowManager');
      targetWindow = createWindow();
    }
    
    // Send message to load the session
    targetWindow.webContents.send('load-session-from-manager', { sessionId, projectPath });
    targetWindow.focus();
    
    return { success: true };
  });

  // Export session to file
  ipcMain.handle('session-manager:export-session', async (event, session: any) => {
    if (!sessionManagerWindow) return { success: false };
    
    const result = await dialog.showSaveDialog(sessionManagerWindow, {
      title: 'Export Session',
      defaultPath: `claude-session-${session.id}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (!result.canceled && result.filePath) {
      try {
        const exportData = {
          ...session,
          exportDate: new Date().toISOString(),
          appVersion: app.getVersion()
        };
        writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
        return { success: true, filePath: result.filePath };
      } catch (error) {
        console.error('Failed to export session:', error);
        return { success: false, error: error.message };
      }
    }
    
    return { success: false };
  });
}

export function closeSessionManagerWindow() {
  if (sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
    sessionManagerWindow.close();
  }
}
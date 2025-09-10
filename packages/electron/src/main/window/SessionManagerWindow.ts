import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { join } from 'path';
import { writeFileSync } from 'fs';
import Store from 'electron-store';

let sessionManagerWindow: BrowserWindow | null = null;

export function createSessionManagerWindow(filterProject?: string) {
  // If window already exists, check if it's healthy
  if (sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
    // Check if the window content is corrupted
    sessionManagerWindow.webContents.executeJavaScript(`
      document.body && document.body.textContent && document.body.textContent.length > 0
    `).then(isHealthy => {
      if (isHealthy) {
        sessionManagerWindow?.focus();
        // Send filter update if provided
        if (filterProject) {
          sessionManagerWindow?.webContents.send('filter-project', filterProject);
        }
      } else {
        // Window content is corrupted, recreate it
        console.warn('[SessionManager] Window content corrupted, recreating window');
        sessionManagerWindow?.destroy();
        sessionManagerWindow = null;
        createSessionManagerWindow(filterProject);
      }
    }).catch(() => {
      // Error checking health, recreate window
      console.warn('[SessionManager] Error checking window health, recreating window');
      sessionManagerWindow?.destroy();
      sessionManagerWindow = null;
      createSessionManagerWindow(filterProject);
    });
    return;
  }

  // Create the window
  sessionManagerWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'AI Chat Sessions - All Projects',
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

  // Load the main app with a query parameter to indicate Session Manager mode
  const loadContent = () => {
    if (process.env.NODE_ENV === 'development') {
      const url = filterProject 
        ? `http://localhost:5273/?mode=session-manager&filterProject=${encodeURIComponent(filterProject)}`
        : 'http://localhost:5273/?mode=session-manager';
      return sessionManagerWindow!.loadURL(url);
    } else {
      const query: any = { mode: 'session-manager' };
      if (filterProject) {
        query.filterProject = filterProject;
      }
      return sessionManagerWindow!.loadFile(join(__dirname, '../renderer/index.html'), { query });
    }
  };

  loadContent().catch(err => {
    console.error('[SessionManager] Failed to load window content:', err);
    // Try to reload once
    setTimeout(() => {
      if (sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
        loadContent().catch(err2 => {
          console.error('[SessionManager] Failed to reload window content:', err2);
        });
      }
    }, 1000);
  });

  // Show window when ready
  sessionManagerWindow.once('ready-to-show', () => {
    sessionManagerWindow?.show();
  });

  // Handle renderer process crashes
  sessionManagerWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[SessionManager] Renderer process gone:', details);
    if (sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
      // Reload the window
      sessionManagerWindow.reload();
    }
  });

  // Handle unresponsive renderer
  sessionManagerWindow.webContents.on('unresponsive', () => {
    console.warn('[SessionManager] Window became unresponsive');
    const choice = dialog.showMessageBoxSync(sessionManagerWindow!, {
      type: 'warning',
      buttons: ['Reload', 'Keep Waiting'],
      defaultId: 0,
      message: 'Session Manager is not responding',
      detail: 'Would you like to reload the window?'
    });
    
    if (choice === 0 && sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
      sessionManagerWindow.reload();
    }
  });

  // Handle responsive again
  sessionManagerWindow.webContents.on('responsive', () => {
    console.log('[SessionManager] Window became responsive again');
  });

  // Clean up when closed
  sessionManagerWindow.on('closed', () => {
    sessionManagerWindow = null;
  });
}

export function registerSessionManagerHandlers() {
  // Get all sessions from all projects
  ipcMain.handle('session-manager:get-all-sessions', async () => {
    const store = new Store({ name: 'ai-sessions' });
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
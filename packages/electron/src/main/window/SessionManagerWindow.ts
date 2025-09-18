import { BrowserWindow, ipcMain, dialog, app } from 'electron';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { AISessionsRepository } from '@stravu/runtime';
import { getWorkspaceRepository } from '../services/RepositoryManager';

let sessionManagerWindow: BrowserWindow | null = null;

export function createSessionManagerWindow(filterWorkspace?: string) {
  // If window already exists, check if it's healthy
  if (sessionManagerWindow && !sessionManagerWindow.isDestroyed()) {
    // Check if the window content is corrupted
    sessionManagerWindow.webContents.executeJavaScript(`
      document.body && document.body.textContent && document.body.textContent.length > 0
    `).then(isHealthy => {
      if (isHealthy) {
        sessionManagerWindow?.focus();
        // Send filter update if provided
        if (filterWorkspace) {
          sessionManagerWindow?.webContents.send('filter-workspace', filterWorkspace);
        }
      } else {
        // Window content is corrupted, recreate it
        console.warn('[SessionManager] Window content corrupted, recreating window');
        sessionManagerWindow?.destroy();
        sessionManagerWindow = null;
        createSessionManagerWindow(filterWorkspace);
      }
    }).catch(() => {
      // Error checking health, recreate window
      console.warn('[SessionManager] Error checking window health, recreating window');
      sessionManagerWindow?.destroy();
      sessionManagerWindow = null;
      createSessionManagerWindow(filterWorkspace);
    });
    return;
  }

  // Create the window
  sessionManagerWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    title: 'AI Chat Sessions - All Workspaces',
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
      const url = filterWorkspace
        ? `http://localhost:5273/?mode=session-manager&filterWorkspace=${encodeURIComponent(filterWorkspace)}`
        : 'http://localhost:5273/?mode=session-manager';
      return sessionManagerWindow!.loadURL(url);
    } else {
      const query: any = { mode: 'session-manager' };
      if (filterWorkspace) {
        query.filterWorkspace = filterWorkspace;
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
  // Get all sessions from all workspaces
  ipcMain.handle('session-manager:get-all-sessions', async () => {
    const workspaces = await getWorkspaceRepository().list();
    const workspaceIds = new Set<string>(workspaces.map(ws => ws.id));

    try {
      const result = await database.query('SELECT DISTINCT workspace_id FROM ai_sessions');
      result.rows.forEach((row: any) => {
        if (row.workspace_id) workspaceIds.add(row.workspace_id);
      });
    } catch (error) {
      console.warn('[SessionManager] Failed to fetch distinct workspace ids from ai_sessions', error);
    }

    const allSessions: any[] = [];
    for (const workspaceId of workspaceIds) {
      try {
        const entries = await AISessionsRepository.list(workspaceId);
        for (const entry of entries) {
          const session = await AISessionsRepository.get(entry.id);
          if (!session) continue;
          allSessions.push({
            id: session.id,
            provider: session.provider,
            model: session.model,
            title: session.title,
            timestamp: session.updatedAt,
            messages: session.messages,
            workspacePath: workspaceId === 'default' ? null : workspaceId,
          });
        }
      } catch (error) {
        console.warn(`[SessionManager] Failed to load sessions for workspace ${workspaceId}:`, error);
      }
    }

    allSessions.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    return allSessions;
  });

  // Open a session
  ipcMain.handle('session-manager:open-session', async (event, sessionId: string, workspacePath?: string) => {
    // Find or create a window
    const windows = BrowserWindow.getAllWindows().filter(w => w !== sessionManagerWindow);
    let targetWindow = windows.find(w => !w.isDestroyed());
    
    if (!targetWindow) {
      // Create a new window if none exists
      const { createWindow } = require('../window/WindowManager');
      targetWindow = createWindow();
    }
    
    // Send message to load the session
    targetWindow.webContents.send('load-session-from-manager', { sessionId, workspacePath });
    targetWindow.focus();
    
    return { success: true };
  });

  // Export session to file
  ipcMain.handle('session-manager:export-session', async (event, session: any) => {
    if (!sessionManagerWindow) return { success: false };

    const latest = await AISessionsRepository.get(session.id);
    const workspacePath = latest?.metadata?.workspaceId ?? session.workspacePath;

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
          ...(latest ?? session),
          workspacePath,
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

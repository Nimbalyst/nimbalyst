import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { AISessionsRepository } from '@nimbalyst/runtime';
import { getAgenticCodingWindowState, saveAgenticCodingWindowState, getTheme } from '../utils/store';
import { windows, windowStates, windowFocusOrder, windowDevToolsState, incrementFocusOrderCounter } from './WindowManager';
import { getBackgroundColor } from '../theme/ThemeManager';

const agenticCodingWindows = new Map<string, BrowserWindow>();

export interface AgenticCodingWindowOptions {
  sessionId?: string;
  workspacePath: string;
  planDocumentPath?: string;
}

export function createAgenticCodingWindow(options: AgenticCodingWindowOptions) {
  const { sessionId, workspacePath, planDocumentPath } = options;
  const windowKey = workspacePath;  // One window per workspace

  // If window already exists for this workspace, focus it
  const existingWindow = agenticCodingWindows.get(windowKey);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.focus();
    return existingWindow;
  }

  // Load saved window state
  const savedState = getAgenticCodingWindowState(workspacePath);
  const bounds = savedState?.bounds || { width: 1400, height: 900 };

  // Create the window
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    title: 'Agentic Coding Session',
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
    backgroundColor: getBackgroundColor()
  });

  // Store the window
  agenticCodingWindows.set(windowKey, window);

  // Register with WindowManager for session state tracking
  // Use Electron's window ID so IPC handlers can find the window state
  const windowId = window.id;
  windows.set(windowId, window);
  windowStates.set(windowId, {
    mode: 'agentic-coding',
    filePath: null,
    workspacePath,
    documentEdited: false
  });
  windowFocusOrder.set(windowId, incrementFocusOrderCounter()); // Use same counter as regular windows
  windowDevToolsState.set(windowId, savedState?.devToolsOpen || false);

  // Load the content
  const loadContent = () => {
    const currentTheme = getTheme();
    const params = new URLSearchParams({
      mode: 'agentic-coding',
      workspacePath,
      theme: currentTheme
    });

    if (sessionId) {
      params.set('sessionId', sessionId);
    }

    if (planDocumentPath) {
      params.set('planDocumentPath', planDocumentPath);
    }

    if (process.env.NODE_ENV === 'development') {
      const url = `http://localhost:5273/?${params.toString()}`;
      return window.loadURL(url);
    } else {
      const query: any = Object.fromEntries(params);
      return window.loadFile(join(__dirname, '../renderer/index.html'), { query });
    }
  };

  loadContent().catch(err => {
    console.error('[AgenticCoding] Failed to load window content:', err);
    setTimeout(() => {
      if (window && !window.isDestroyed()) {
        loadContent().catch(err2 => {
          console.error('[AgenticCoding] Failed to reload window content:', err2);
        });
      }
    }, 1000);
  });

  // Show window when ready
  window.once('ready-to-show', () => {
    window.show();

    // Restore dev tools if they were open
    if (savedState?.devToolsOpen) {
      window.webContents.openDevTools();
    }
  });

  // Update focus order when window gains focus
  window.on('focus', () => {
    windowFocusOrder.set(windowId, incrementFocusOrderCounter());
  });

  // Handle renderer process crashes
  window.webContents.on('render-process-gone', (event, details) => {
    console.error('[AgenticCoding] Renderer process gone:', details);
    if (window && !window.isDestroyed()) {
      window.reload();
    }
  });

  // Save window state before closing
  window.on('close', () => {
    if (!window.isDestroyed()) {
      const bounds = window.getBounds();
      const devToolsOpen = window.webContents.isDevToolsOpened();

      saveAgenticCodingWindowState(workspacePath, {
        bounds,
        devToolsOpen
      });
    }
  });

  // Clean up on close
  window.on('closed', () => {
    agenticCodingWindows.delete(windowKey);
    windows.delete(windowId);
    windowStates.delete(windowId);
    windowFocusOrder.delete(windowId);
    windowDevToolsState.delete(windowId);
  });

  return window;
}

export function getAgenticCodingWindow(sessionId: string): BrowserWindow | undefined {
  const window = agenticCodingWindows.get(sessionId);
  return window && !window.isDestroyed() ? window : undefined;
}

export function closeAgenticCodingWindow(sessionId: string): void {
  const window = agenticCodingWindows.get(sessionId);
  if (window && !window.isDestroyed()) {
    window.close();
  }
}

export function getAllAgenticCodingWindows(): BrowserWindow[] {
  return Array.from(agenticCodingWindows.values()).filter(w => !w.isDestroyed());
}

// IPC Handlers
ipcMain.handle('agentic-coding:create-window', async (_event, options: AgenticCodingWindowOptions) => {
  const window = createAgenticCodingWindow(options);
  return { success: true, windowId: window.id };
});

ipcMain.handle('agentic-coding:close-window', async (_event, sessionId: string) => {
  closeAgenticCodingWindow(sessionId);
  return { success: true };
});

ipcMain.handle('agentic-coding:get-session-data', async (_event, sessionId: string) => {
  try {
    const sessionData = await AISessionsRepository.get(sessionId);
    return { success: true, data: sessionData };
  } catch (error) {
    console.error('[AgenticCoding] Failed to get session data:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('agentic-coding:update-session-metadata', async (_event, sessionId: string, updates: any) => {
  try {
    // Extract sessionType and metadata from updates
    const { sessionType, ...metadataFields } = updates;

    // Build update payload
    const updatePayload: any = {};
    if (sessionType !== undefined) {
      updatePayload.sessionType = sessionType;
    }
    if (Object.keys(metadataFields).length > 0) {
      updatePayload.metadata = metadataFields;
    }

    await AISessionsRepository.updateMetadata(sessionId, updatePayload);

    // Notify all agentic coding windows about the update
    getAllAgenticCodingWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('agentic-coding:session-updated', sessionId, metadataFields);
      }
    });

    return { success: true };
  } catch (error) {
    console.error('[AgenticCoding] Failed to update session metadata:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('sessions:list', async (_event, workspacePath: string) => {
  try {
    const entries = await AISessionsRepository.list(workspacePath);
    const sessions = [];

    for (const entry of entries) {
      const session = await AISessionsRepository.get(entry.id);
      if (session) {
        sessions.push({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          name: session.title,
          title: session.title,
          provider: session.provider,
          model: session.model,
          sessionType: session.sessionType || 'chat',
          messageCount: entry.messageCount || 0, // Use messageCount from list entry, not session.messages
          metadata: session.metadata || {}
        });
      }
    }

    return { success: true, sessions };
  } catch (error) {
    console.error('[AgenticCoding] Failed to list sessions:', error);
    return { success: false, error: String(error), sessions: [] };
  }
});

ipcMain.handle('sessions:search', async (_event, workspacePath: string, query: string) => {
  try {
    const entries = await AISessionsRepository.search(workspacePath, query);
    const sessions = [];

    for (const entry of entries) {
      const session = await AISessionsRepository.get(entry.id);
      if (session) {
        sessions.push({
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          name: session.title,
          title: session.title,
          provider: session.provider,
          model: session.model,
          sessionType: session.sessionType || 'chat',
          messageCount: entry.messageCount || 0,
          metadata: session.metadata || {}
        });
      }
    }

    return { success: true, sessions };
  } catch (error) {
    console.error('[AgenticCoding] Failed to search sessions:', error);
    return { success: false, error: String(error), sessions: [] };
  }
});

ipcMain.handle('sessions:delete', async (_event, sessionId: string) => {
  try {
    await AISessionsRepository.delete(sessionId);
    return { success: true };
  } catch (error) {
    console.error('[AgenticCoding] Failed to delete session:', error);
    return { success: false, error: String(error) };
  }
});


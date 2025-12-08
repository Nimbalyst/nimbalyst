import { BrowserWindow, nativeTheme, app } from 'electron';
import { join } from 'path';
import { getTheme } from '../utils/store';

let updateWindow: BrowserWindow | null = null;

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface DownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export function createUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.focus();
    return updateWindow;
  }

  const currentTheme = getTheme();
  const isDarkTheme = nativeTheme.shouldUseDarkColors || currentTheme === 'dark' || currentTheme === 'crystal-dark';

  updateWindow = new BrowserWindow({
    width: 600,
    height: 700,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Update Available',
    show: false,
    backgroundColor: isDarkTheme ? '#2d2d2d' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false
    }
  });

  // Load the update.html file
  // Always load from file system since update.html is a standalone page
  // and not served by the dev server
  const updateHtmlPath = process.env.NODE_ENV === 'development'
    ? join(__dirname, '../../src/renderer/update.html')
    : join(__dirname, '../renderer/update.html');
  updateWindow.loadFile(updateHtmlPath);

  updateWindow.once('ready-to-show', () => {
    updateWindow?.show();
  });

  updateWindow.on('closed', () => {
    updateWindow = null;
  });

  return updateWindow;
}

export function showUpdateAvailable(updateInfo: UpdateInfo) {
  const window = createUpdateWindow();
  const currentVersion = app.getVersion();

  const sendData = () => {
    window.webContents.send('update-window:show-available', {
      currentVersion,
      newVersion: updateInfo.version,
      releaseNotes: updateInfo.releaseNotes || '',
      releaseDate: updateInfo.releaseDate
    });
  };

  // If window is already loaded, send immediately
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', sendData);
  } else {
    // Give a brief moment for renderer to be ready
    setTimeout(sendData, 100);
  }
}

export function showDownloadProgress(progress: DownloadProgress) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update-window:progress', progress);
  }
}

export function showUpdateReady(updateInfo: UpdateInfo) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update-window:show-ready', {
      version: updateInfo.version
    });
  }
}

export function showUpdateError(errorMessage: string) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update-window:error', {
      message: errorMessage
    });
  }
}

export function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
}


export function getUpdateWindow(): BrowserWindow | null {
  return updateWindow;
}

// Test helpers - only used in test environment
if (process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT === '1') {
  const { ipcMain } = require('electron');

  ipcMain.handle('test:trigger-update-available', (_event: Electron.IpcMainInvokeEvent, updateInfo: UpdateInfo) => {
    showUpdateAvailable(updateInfo);
  });

  ipcMain.handle('test:trigger-download-progress', (_event: Electron.IpcMainInvokeEvent, progress: DownloadProgress) => {
    showDownloadProgress(progress);
  });

  ipcMain.handle('test:trigger-update-ready', (_event: Electron.IpcMainInvokeEvent, updateInfo: UpdateInfo) => {
    showUpdateReady(updateInfo);
  });

  ipcMain.handle('test:trigger-update-error', (_event: Electron.IpcMainInvokeEvent, errorMessage: string) => {
    showUpdateError(errorMessage);
  });

  ipcMain.handle('test:close-update-window', () => {
    closeUpdateWindow();
  });
}

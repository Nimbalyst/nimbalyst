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
    backgroundColor: isDarkTheme ? '#2a2a2a' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false
    }
  });

  // Load the update.html file
  if (process.env['ELECTRON_RENDERER_URL']) {
    updateWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/update.html`);
  } else {
    updateWindow.loadFile(join(__dirname, '../renderer/update.html'));
  }

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

  window.webContents.once('did-finish-load', () => {
    window.webContents.send('update-window:show-available', {
      currentVersion,
      newVersion: updateInfo.version,
      releaseNotes: updateInfo.releaseNotes || '',
      releaseDate: updateInfo.releaseDate
    });
  });
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

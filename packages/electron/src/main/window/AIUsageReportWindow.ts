import { BrowserWindow } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';

let usageReportWindow: BrowserWindow | null = null;

export function createAIUsageReportWindow(): BrowserWindow {
  // If window already exists, focus it
  if (usageReportWindow && !usageReportWindow.isDestroyed()) {
    usageReportWindow.focus();
    return usageReportWindow;
  }

  // Create the browser window
  usageReportWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'AI Usage Report',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  usageReportWindow.on('ready-to-show', () => {
    usageReportWindow?.show();
  });

  usageReportWindow.on('closed', () => {
    usageReportWindow = null;
  });

  // Load the usage report page
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    usageReportWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=usage-report`);
  } else {
    usageReportWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { mode: 'usage-report' },
    });
  }

  return usageReportWindow;
}

export function getAIUsageReportWindow(): BrowserWindow | null {
  return usageReportWindow;
}

export function closeAIUsageReportWindow(): void {
  if (usageReportWindow && !usageReportWindow.isDestroyed()) {
    usageReportWindow.close();
  }
}

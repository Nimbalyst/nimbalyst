import { ipcMain, BrowserWindow, app, shell } from 'electron';
import { join } from 'path';
import { setTheme } from '../utils/store';
import { updateNativeTheme, updateWindowTitleBars } from '../theme/ThemeManager';

export function registerPreferencesHandlers() {
  // Theme handlers
  ipcMain.handle('set-theme', async (event, theme: string) => {
    setTheme(theme);
    updateNativeTheme();
    updateWindowTitleBars();
    
    // Notify all windows of theme change
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('theme-change', theme);
    });
    
    return { success: true };
  });

  // Open app data folder
  ipcMain.handle('preferences:openDataFolder', async () => {
    const userDataPath = app.getPath('userData');
    await shell.openPath(userDataPath);
    return { success: true };
  });
}
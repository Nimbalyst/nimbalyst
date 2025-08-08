import { ipcMain, BrowserWindow } from 'electron';
import Store from 'electron-store';
import { setTheme } from '../utils/store';
import { updateNativeTheme, updateWindowTitleBars } from '../theme/ThemeManager';

const preferencesStore = new Store({
  name: 'preferences',
  defaults: {
    general: {
      autoSave: true,
      autoSaveInterval: 60,
      showLineNumbers: true,
      showWordCount: true
    },
    editor: {
      fontSize: 14,
      fontFamily: 'system',
      tabSize: 2,
      wordWrap: true,
      highlightActiveLine: true,
      showInvisibles: false
    }
  }
});

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

  // General preferences
  ipcMain.handle('preferences:getGeneral', async () => {
    return preferencesStore.get('general');
  });

  ipcMain.handle('preferences:saveGeneral', async (event, settings) => {
    preferencesStore.set('general', {
      ...preferencesStore.get('general'),
      ...settings
    });
    
    // Notify all windows of settings change
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('general-settings-changed', settings);
    });
    
    return { success: true };
  });

  // Editor preferences
  ipcMain.handle('preferences:getEditor', async () => {
    return preferencesStore.get('editor');
  });

  ipcMain.handle('preferences:saveEditor', async (event, settings) => {
    preferencesStore.set('editor', {
      ...preferencesStore.get('editor'),
      ...settings
    });
    
    // Notify all windows of settings change
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('editor-settings-changed', settings);
    });
    
    return { success: true };
  });
}

export { preferencesStore };
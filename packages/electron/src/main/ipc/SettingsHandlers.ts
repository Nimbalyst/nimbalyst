import { ipcMain } from 'electron';
import { getSidebarWidth, setSidebarWidth, getTheme } from '../utils/store';

export function registerSettingsHandlers() {
    // Get sidebar width
    ipcMain.handle('get-sidebar-width', () => {
        return getSidebarWidth();
    });

    // Set sidebar width
    ipcMain.on('set-sidebar-width', (event, width: number) => {
        setSidebarWidth(width);
    });

    // Get theme
    ipcMain.handle('get-theme', () => {
        return getTheme();
    });
}
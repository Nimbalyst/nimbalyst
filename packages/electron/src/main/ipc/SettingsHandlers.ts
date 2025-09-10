import { ipcMain } from 'electron';
import { getSidebarWidth, setSidebarWidth, getTheme, getAIChatState, setAIChatState } from '../utils/store';

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

    // Get app version (from app.getVersion)
    ipcMain.handle('get-app-version', () => {
        const { app } = require('electron');
        return app.getVersion();
    });

    // Get AI Chat state
    ipcMain.handle('get-ai-chat-state', () => {
        return getAIChatState();
    });

    // Set AI Chat state
    ipcMain.on('set-ai-chat-state', (event, state: { collapsed: boolean; width: number; sessionId?: string }) => {
        setAIChatState(state);
    });
}

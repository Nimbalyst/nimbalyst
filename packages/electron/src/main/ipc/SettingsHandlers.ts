import { ipcMain } from 'electron';
import { getWorkspaceState, updateWorkspaceState, getTheme } from '../utils/store';
import { logger } from '../utils/logger';

export function registerSettingsHandlers() {
    // Get sidebar width
    ipcMain.handle('get-sidebar-width', (_event, workspacePath: string) => {
        if (!workspacePath) {
            throw new Error('workspacePath is required for get-sidebar-width');
        }
        return getWorkspaceState(workspacePath).sidebarWidth;
    });

    // Set sidebar width
    ipcMain.on('set-sidebar-width', (_event, payload: { workspacePath: string; width: number }) => {
        if (!payload?.workspacePath) {
            logger.store.warn('[ipc] set-sidebar-width called without workspacePath');
            return;
        }
        updateWorkspaceState(payload.workspacePath, state => {
            state.sidebarWidth = payload.width;
        });
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
    ipcMain.handle('get-ai-chat-state', (_event, workspacePath: string) => {
        if (!workspacePath) {
            throw new Error('workspacePath is required for get-ai-chat-state');
        }
        return getWorkspaceState(workspacePath).aiPanel;
    });

    // Set AI Chat state
    ipcMain.on('set-ai-chat-state', (_event, payload: { collapsed: boolean; width: number; currentSessionId?: string; draftInput?: string; planningModeEnabled?: boolean; workspacePath: string }) => {
        if (!payload?.workspacePath) {
            logger.store.warn('[ipc] set-ai-chat-state called without workspacePath');
            return;
        }
        updateWorkspaceState(payload.workspacePath, state => {
            state.aiPanel = {
                collapsed: payload.collapsed,
                width: payload.width,
                currentSessionId: payload.currentSessionId,
                draftInput: payload.draftInput,
                planningModeEnabled: payload.planningModeEnabled ?? state.aiPanel?.planningModeEnabled ?? true,
            };
        });
    });
}

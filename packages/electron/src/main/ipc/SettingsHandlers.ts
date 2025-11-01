import { ipcMain } from 'electron';
import { getWorkspaceState, updateWorkspaceState, getTheme, isFirstLaunch, markAppLaunched, isSettingsCompleted, markSettingsCompleted, isCompletionSoundEnabled, setCompletionSoundEnabled, getCompletionSoundType, setCompletionSoundType, CompletionSoundType } from '../utils/store';
import { logger } from '../utils/logger';
import { SoundNotificationService } from '../services/SoundNotificationService';

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

    // Get theme (async)
    ipcMain.handle('get-theme', () => {
        return getTheme();
    });

    // Get theme (sync) - for immediate HTML script use
    ipcMain.on('get-theme-sync', (event) => {
        event.returnValue = getTheme();
    });

    // Get app version (from app.getVersion)
    ipcMain.handle('get-app-version', () => {
        const { app } = require('electron');
        return app.getVersion();
    });

    // AI Chat state has been moved to unified workspace state
    // Use workspace:get-state and workspace:update-state instead

    // First launch detection
    ipcMain.handle('first-launch:is-first-launch', () => {
        return isFirstLaunch();
    });

    ipcMain.handle('first-launch:mark-launched', () => {
        markAppLaunched();
    });

    ipcMain.handle('first-launch:is-settings-completed', () => {
        return isSettingsCompleted();
    });

    ipcMain.handle('first-launch:mark-settings-completed', () => {
        markSettingsCompleted();
    });

    // Completion sound settings
    ipcMain.handle('completion-sound:is-enabled', () => {
        return isCompletionSoundEnabled();
    });

    ipcMain.handle('completion-sound:set-enabled', (_event, enabled: boolean) => {
        setCompletionSoundEnabled(enabled);
    });

    ipcMain.handle('completion-sound:get-type', () => {
        return getCompletionSoundType();
    });

    ipcMain.handle('completion-sound:set-type', (_event, soundType: CompletionSoundType) => {
        setCompletionSoundType(soundType);
    });

    ipcMain.handle('completion-sound:test', (_event, soundType: CompletionSoundType) => {
        const soundService = SoundNotificationService.getInstance();
        soundService.testSound(soundType);
    });
}

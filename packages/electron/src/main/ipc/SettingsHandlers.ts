import { ipcMain } from 'electron';
import { getWorkspaceState, updateWorkspaceState, getTheme, getThemeSync, isCompletionSoundEnabled, setCompletionSoundEnabled, getCompletionSoundType, setCompletionSoundType, CompletionSoundType, getReleaseChannel, setReleaseChannel, ReleaseChannel, getRecentItems, getUserOnboardingState, setUserRole, setUserEmail, setOnboardingNextPrompt, clearOnboardingNextPrompt, getDefaultAIModel, setDefaultAIModel } from '../utils/store';
import { logger } from '../utils/logger';
import { SoundNotificationService } from '../services/SoundNotificationService';
import { autoUpdaterService } from '../services/autoUpdater';
import type { OnboardingState } from '../utils/store';

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
    // CRITICAL: Must use getThemeSync() to resolve 'system' to actual theme
    ipcMain.on('get-theme-sync', (event) => {
        event.returnValue = getThemeSync();
    });

    // Get app version (from app.getVersion)
    ipcMain.handle('get-app-version', () => {
        const { app } = require('electron');
        return app.getVersion();
    });

    // AI Chat state has been moved to unified workspace state
    // Use workspace:get-state and workspace:update-state instead

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

    // Release channel settings
    ipcMain.handle('release-channel:get', () => {
        return getReleaseChannel();
    });

    ipcMain.handle('release-channel:set', (_event, channel: ReleaseChannel) => {
        setReleaseChannel(channel);
        // Reconfigure auto-updater with new channel
        autoUpdaterService.reconfigureFeedURL();
        logger.store.info(`[SettingsHandlers] Release channel changed to ${channel}, auto-updater reconfigured`);
    });

    // Get recent projects
    ipcMain.handle('settings:get-recent-projects', () => {
        return getRecentItems('workspaces');
    });

    // User onboarding state handlers
    ipcMain.handle('onboarding:get-state', () => {
        return getUserOnboardingState();
    });

    ipcMain.handle('onboarding:set-role', (_event, role: string) => {
        setUserRole(role);
    });

    ipcMain.handle('onboarding:set-email', (_event, email: string) => {
        setUserEmail(email);
    });

    ipcMain.handle('onboarding:set-next-prompt', (_event, timestamp: number | undefined) => {
        setOnboardingNextPrompt(timestamp);
    });

    ipcMain.handle('onboarding:clear-next-prompt', () => {
        clearOnboardingNextPrompt();
    });

    // Default AI model settings
    ipcMain.handle('settings:get-default-ai-model', () => {
        return getDefaultAIModel();
    });

    ipcMain.handle('settings:set-default-ai-model', (_event, model: string) => {
        setDefaultAIModel(model);
    });
}

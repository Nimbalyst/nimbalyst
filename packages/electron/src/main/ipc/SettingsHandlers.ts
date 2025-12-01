import { ipcMain } from 'electron';
import { getWorkspaceState, updateWorkspaceState, getTheme, getThemeSync, isCompletionSoundEnabled, setCompletionSoundEnabled, getCompletionSoundType, setCompletionSoundType, CompletionSoundType, getReleaseChannel, setReleaseChannel, ReleaseChannel, getRecentItems, getDefaultAIModel, setDefaultAIModel, isAnalyticsEnabled, setAnalyticsEnabled, isWireframeLMEnabled, setWireframeLMEnabled, getSessionSyncConfig, setSessionSyncConfig, SessionSyncConfig } from '../utils/store';
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

    // Onboarding state
    ipcMain.handle('onboarding:get', async () => {
        const { getOnboardingState } = await import('../utils/store');
        return getOnboardingState();
    });

    ipcMain.handle('onboarding:update', async (_event, state: Partial<OnboardingState>) => {
        const { updateOnboardingState } = await import('../utils/store');
        updateOnboardingState(state);
    });

    // Default AI model settings
    ipcMain.handle('settings:get-default-ai-model', () => {
        return getDefaultAIModel();
    });

    ipcMain.handle('settings:set-default-ai-model', (_event, model: string) => {
        setDefaultAIModel(model);
    });

    // Analytics settings
    ipcMain.handle('analytics:is-enabled', () => {
        return isAnalyticsEnabled();
    });

    ipcMain.handle('analytics:set-enabled', (_event, enabled: boolean) => {
        setAnalyticsEnabled(enabled);
    });

    // WireframeLM settings
    ipcMain.handle('wireframeLM:is-enabled', () => {
        return isWireframeLMEnabled();
    });

    ipcMain.handle('wireframeLM:set-enabled', (_event, enabled: boolean) => {
        setWireframeLMEnabled(enabled);
        logger.store.info(`[SettingsHandlers] WireframeLM ${enabled ? 'enabled' : 'disabled'}`);
    });

    // Session sync settings
    ipcMain.handle('sync:get-config', () => {
        return getSessionSyncConfig();
    });

    ipcMain.handle('sync:set-config', (_event, config: SessionSyncConfig | null) => {
        setSessionSyncConfig(config ?? undefined);
        logger.store.info(`[SettingsHandlers] Session sync ${config?.enabled ? 'enabled' : 'disabled'}`);
    });

    ipcMain.handle('sync:test-connection', async (_event, config: SessionSyncConfig) => {
        // Simple test - try to connect to the health endpoint
        if (!config.serverUrl) {
            return { success: false, error: 'Server URL is required' };
        }

        try {
            // Convert ws:// to http:// for health check
            const httpUrl = config.serverUrl
                .replace(/^ws:/, 'http:')
                .replace(/^wss:/, 'https:')
                .replace(/\/$/, '');

            const response = await fetch(`${httpUrl}/health`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${config.userId}:${config.authToken}`,
                },
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                // CollabV3 returns plain text "OK", collabv2 returns JSON
                const text = await response.text();
                try {
                    const data = JSON.parse(text);
                    return { success: true, data };
                } catch {
                    // Plain text response (e.g., "OK" from CollabV3)
                    return { success: true, data: { status: text } };
                }
            } else {
                return { success: false, error: `Server returned ${response.status}` };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Connection failed';
            return { success: false, error: message };
        }
    });

    // Get sync status for the navigation gutter button
    ipcMain.handle('sync:get-status', async (_event, workspacePath?: string) => {
        const config = getSessionSyncConfig();

        // Not configured at all
        if (!config?.enabled || !config.serverUrl || !config.userId || !config.authToken) {
            return {
                appConfigured: false,
                projectEnabled: false,
                connected: false,
                syncing: false,
                error: null,
                stats: {
                    sessionCount: 0,
                    lastSyncedAt: null,
                },
            };
        }

        // Check if project is enabled
        const isProjectEnabled = !config.enabledProjects ||
            (workspacePath ? config.enabledProjects.includes(workspacePath) : true);

        // Get sync provider status from SyncManager
        const { isSyncEnabled, getSyncProvider } = await import('../services/SyncManager');
        const provider = getSyncProvider();
        const syncActive = isSyncEnabled();

        // Get session count for this workspace
        let sessionCount = 0;
        let lastSyncedAt: number | null = null;

        if (workspacePath && syncActive) {
            try {
                const { getAllSessionsForSync } = await import('../services/PGLiteSessionStore');
                const allSessions = await getAllSessionsForSync(false);
                // Filter sessions for this workspace
                const sessions = allSessions.filter(s => s.workspaceId === workspacePath || s.workspacePath === workspacePath);
                sessionCount = sessions.length;
                // Find most recent update
                for (const session of sessions) {
                    if (session.updatedAt && (!lastSyncedAt || session.updatedAt > lastSyncedAt)) {
                        lastSyncedAt = session.updatedAt;
                    }
                }
            } catch (error) {
                logger.store.warn('[sync:get-status] Failed to get session count:', error);
            }
        }

        // Check connection status
        // The provider doesn't expose a direct "isConnected" status, but we can infer from syncActive
        const connected = syncActive && provider !== null;

        return {
            appConfigured: true,
            projectEnabled: isProjectEnabled,
            connected,
            syncing: false, // We don't have real-time syncing status yet
            error: null,
            stats: {
                sessionCount,
                lastSyncedAt,
            },
        };
    });

    // Toggle sync for a specific project
    ipcMain.handle('sync:toggle-project', async (_event, workspacePath: string, enabled: boolean) => {
        if (!workspacePath) {
            throw new Error('workspacePath is required for sync:toggle-project');
        }

        const config = getSessionSyncConfig();
        if (!config) {
            throw new Error('Sync is not configured');
        }

        let enabledProjects = config.enabledProjects || [];

        if (enabled) {
            // Add project to enabled list if not already present
            if (!enabledProjects.includes(workspacePath)) {
                enabledProjects = [...enabledProjects, workspacePath];
            }
        } else {
            // Remove project from enabled list
            enabledProjects = enabledProjects.filter(p => p !== workspacePath);
        }

        // Save updated config
        setSessionSyncConfig({
            ...config,
            enabledProjects,
        });

        logger.store.info(`[sync:toggle-project] Project sync ${enabled ? 'enabled' : 'disabled'} for: ${workspacePath}`);

        return { success: true };
    });
}

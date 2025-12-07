import { ipcMain, BrowserWindow } from 'electron';
import * as os from 'os';
import { getWorkspaceState, updateWorkspaceState, getTheme, getThemeSync, isCompletionSoundEnabled, setCompletionSoundEnabled, getCompletionSoundType, setCompletionSoundType, CompletionSoundType, getReleaseChannel, setReleaseChannel, ReleaseChannel, getRecentItems, getDefaultAIModel, setDefaultAIModel, isAnalyticsEnabled, setAnalyticsEnabled, isMockupLMEnabled, setMockupLMEnabled, getSessionSyncConfig, setSessionSyncConfig, SessionSyncConfig } from '../utils/store';
import { logger } from '../utils/logger';
import { SoundNotificationService } from '../services/SoundNotificationService';
import { autoUpdaterService } from '../services/autoUpdater';
import type { OnboardingState } from '../utils/store';
import { getCredentials, getUserId, resetCredentials, generateQRPairingPayload, isUsingSecureStorage } from '../services/CredentialService';
import { onSyncStatusChange } from '../services/SyncManager';
import * as StytchAuth from '../services/StytchAuthService';

// Track if we've subscribed to sync status changes
let syncStatusListenerSetup = false;

/**
 * Get the local network IP address (for LAN access from mobile devices)
 */
function getLocalNetworkIP(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        if (!iface) continue;
        for (const info of iface) {
            // Skip internal (loopback) and non-IPv4 addresses
            if (info.internal || info.family !== 'IPv4') continue;
            // Return the first non-internal IPv4 address
            return info.address;
        }
    }
    return null;
}

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

    // Feature walkthrough state (shown on first launch)
    ipcMain.handle('feature-walkthrough:is-completed', async () => {
        const { isFeatureWalkthroughCompleted } = await import('../utils/store');
        return isFeatureWalkthroughCompleted();
    });

    ipcMain.handle('feature-walkthrough:set-completed', async (_event, completed: boolean) => {
        const { setFeatureWalkthroughCompleted } = await import('../utils/store');
        setFeatureWalkthroughCompleted(completed);
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

    // MockupLM settings
    ipcMain.handle('mockupLM:is-enabled', () => {
        return isMockupLMEnabled();
    });

    ipcMain.handle('mockupLM:set-enabled', (_event, enabled: boolean) => {
        setMockupLMEnabled(enabled);
        logger.store.info(`[SettingsHandlers] MockupLM ${enabled ? 'enabled' : 'disabled'}`);
    });

    // Session sync settings
    ipcMain.handle('sync:get-config', () => {
        return getSessionSyncConfig();
    });

    ipcMain.handle('sync:set-config', async (_event, config: SessionSyncConfig | null) => {
        setSessionSyncConfig(config ?? undefined);
        logger.store.info(`[SettingsHandlers] Session sync ${config?.enabled ? 'enabled' : 'disabled'}`);

        // Reinitialize sync with the new configuration
        try {
            const { repositoryManager } = await import('../services/RepositoryManager');
            await repositoryManager.reinitializeSyncWithNewConfig();
        } catch (error) {
            logger.store.error('[SettingsHandlers] Failed to reinitialize sync:', error);
        }
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

    // Get connected devices from the sync server
    ipcMain.handle('sync:get-devices', async () => {
        const config = getSessionSyncConfig();

        if (!config?.enabled || !config.serverUrl) {
            return { success: false, devices: [], error: 'Sync not configured' };
        }

        try {
            // Get credentials
            const { getCredentials } = await import('../services/CredentialService');
            const credentials = getCredentials();

            // Fetch via the /api/sessions endpoint which forwards to IndexRoom status
            const httpUrl = config.serverUrl
                .replace(/^ws:/, 'http:')
                .replace(/^wss:/, 'https:')
                .replace(/\/$/, '');

            const response = await fetch(`${httpUrl}/api/sessions`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${credentials.userId}:${credentials.authToken}`,
                },
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    success: true,
                    devices: data.devices || [],
                    sessionCount: data.session_count || 0,
                    projectCount: data.project_count || 0,
                };
            } else {
                return { success: false, devices: [], error: `Server returned ${response.status}` };
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get devices';
            return { success: false, devices: [], error: message };
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

        // Get session count for this workspace using a simple, fast query
        let sessionCount = 0;
        let lastSyncedAt: number | null = null;

        if (workspacePath && syncActive) {
            try {
                // Get session count for status display (only called on mount, not polled)
                const { database } = await import('../database/PGLiteDatabaseWorker');
                const { rows } = await database.query<{ count: string; max_updated: Date | null }>(
                    `SELECT COUNT(*) as count, MAX(updated_at) as max_updated
                     FROM ai_sessions
                     WHERE workspace_id = $1 AND (is_archived = FALSE OR is_archived IS NULL)`,
                    [workspacePath]
                );
                if (rows[0]) {
                    sessionCount = parseInt(rows[0].count) || 0;
                    if (rows[0].max_updated) {
                        lastSyncedAt = rows[0].max_updated instanceof Date
                            ? rows[0].max_updated.getTime()
                            : new Date(rows[0].max_updated).getTime();
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

    // Subscribe to sync status changes and broadcast to all windows
    // This is called once when the first window requests it
    ipcMain.handle('sync:subscribe-status', () => {
        if (syncStatusListenerSetup) {
            return; // Already subscribed
        }
        syncStatusListenerSetup = true;

        onSyncStatusChange((status) => {
            // Broadcast to all windows
            for (const window of BrowserWindow.getAllWindows()) {
                window.webContents.send('sync:status-changed', status);
            }
        });

        logger.store.info('[sync:subscribe-status] Subscribed to sync status changes');
    });

    // ============================================================
    // Credential Management (for sync and mobile pairing)
    // ============================================================

    // Get user ID (read-only, for display in settings)
    ipcMain.handle('credentials:get-user-id', () => {
        return getUserId();
    });

    // Get full credentials (for internal use, not exposed to UI except user ID)
    ipcMain.handle('credentials:get', () => {
        const creds = getCredentials();
        return {
            userId: creds.userId,
            createdAt: creds.createdAt,
            isSecure: isUsingSecureStorage(),
        };
    });

    // Reset credentials (generates new ones - invalidates paired devices)
    ipcMain.handle('credentials:reset', () => {
        const creds = resetCredentials();
        return {
            userId: creds.userId,
            createdAt: creds.createdAt,
            isSecure: isUsingSecureStorage(),
        };
    });

    // Generate QR pairing payload for mobile device
    ipcMain.handle('credentials:generate-qr-payload', (_event, serverUrl: string, expiresInMinutes?: number) => {
        if (!serverUrl) {
            throw new Error('serverUrl is required for QR pairing');
        }
        return generateQRPairingPayload(serverUrl, expiresInMinutes);
    });

    // Check if secure storage (keychain) is available
    ipcMain.handle('credentials:is-secure', () => {
        return isUsingSecureStorage();
    });

    // Get local network IP for mobile pairing with local dev server
    ipcMain.handle('network:get-local-ip', () => {
        return getLocalNetworkIP();
    });

    // ============================================================
    // Stytch Authentication (for account-based sync)
    // ============================================================

    // Get current Stytch auth state
    ipcMain.handle('stytch:get-auth-state', () => {
        return StytchAuth.getAuthState();
    });

    // Check if user is authenticated with Stytch
    ipcMain.handle('stytch:is-authenticated', () => {
        return StytchAuth.isAuthenticated();
    });

    // Sign in with Google OAuth
    ipcMain.handle('stytch:sign-in-google', async () => {
        // Get the sync server URL from settings (for local dev, this could be http://localhost:8790)
        const syncConfig = getSessionSyncConfig();
        // Convert WebSocket URLs to HTTP: wss:// -> https://, ws:// -> http://
        const serverUrl = syncConfig?.serverUrl?.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
        return StytchAuth.signInWithGoogle(serverUrl);
    });

    // Send magic link for passwordless authentication
    ipcMain.handle('stytch:send-magic-link', async (_event, email: string) => {
        if (!email) {
            return { success: false, error: 'Email is required' };
        }
        // Get the sync server URL from settings (for local dev, this could be http://localhost:8790)
        const syncConfig = getSessionSyncConfig();
        // Convert WebSocket URLs to HTTP: wss:// -> https://, ws:// -> http://
        const serverUrl = syncConfig?.serverUrl?.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
        return StytchAuth.sendMagicLink(email, serverUrl);
    });

    // Sign out
    ipcMain.handle('stytch:sign-out', async () => {
        await StytchAuth.signOut();
        return { success: true };
    });

    // Get session JWT for server authentication
    ipcMain.handle('stytch:get-session-jwt', () => {
        return StytchAuth.getSessionJwt();
    });

    // Validate and refresh the current session
    ipcMain.handle('stytch:refresh-session', async () => {
        return StytchAuth.validateAndRefreshSession();
    });

    // Issue a device token for mobile pairing
    ipcMain.handle('stytch:issue-device-token', (_event, deviceName: string, deviceType?: 'mobile' | 'tablet') => {
        if (!deviceName) {
            return null;
        }
        return StytchAuth.issueDeviceToken(deviceName, deviceType || 'mobile');
    });

    // Get all device tokens for current user
    ipcMain.handle('stytch:get-device-tokens', () => {
        return StytchAuth.getDeviceTokens();
    });

    // Revoke a device token
    ipcMain.handle('stytch:revoke-device-token', (_event, deviceId: string) => {
        if (!deviceId) {
            return false;
        }
        return StytchAuth.revokeDeviceToken(deviceId);
    });

    // Subscribe to auth state changes
    ipcMain.handle('stytch:subscribe-auth-state', () => {
        // Set up listener to broadcast auth state changes to all windows
        StytchAuth.onAuthStateChange((state) => {
            for (const window of BrowserWindow.getAllWindows()) {
                window.webContents.send('stytch:auth-state-changed', state);
            }
        });
        return StytchAuth.getAuthState();
    });
}

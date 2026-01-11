import { BrowserWindow } from 'electron';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import * as os from 'os';
import { getWorkspaceState, updateWorkspaceState, getTheme, getThemeSync, isCompletionSoundEnabled, setCompletionSoundEnabled, getCompletionSoundType, setCompletionSoundType, CompletionSoundType, getReleaseChannel, setReleaseChannel, ReleaseChannel, getRecentItems, getDefaultAIModel, setDefaultAIModel, isAnalyticsEnabled, setAnalyticsEnabled, isMockupLMEnabled, setMockupLMEnabled, getSessionSyncConfig, setSessionSyncConfig, SessionSyncConfig, isExtensionDevToolsEnabled, setExtensionDevToolsEnabled } from '../utils/store';
import { logger } from '../utils/logger';
import { SoundNotificationService } from '../services/SoundNotificationService';
import { autoUpdaterService } from '../services/autoUpdater';
import type { OnboardingState } from '../utils/store';
import { getCredentials, resetCredentials, generateQRPairingPayload, isUsingSecureStorage } from '../services/CredentialService';
import { onSyncStatusChange } from '../services/SyncManager';
import * as StytchAuth from '../services/StytchAuthService';
import { STYTCH_CONFIG } from '@nimbalyst/runtime';

// Track if we've subscribed to sync status changes
let syncStatusListenerSetup = false;

// Track if Stytch has been initialized
let stytchInitialized = false;

/**
 * Ensure Stytch is initialized based on current sync config.
 * This is called lazily when any Stytch IPC is invoked.
 */
function ensureStytchInitialized(): void {
    if (stytchInitialized) return;

    const syncConfig = getSessionSyncConfig();
    const isDev = process.env.NODE_ENV !== 'production';

    // Only honor environment config in dev builds - production builds always use production
    // Default to production even in dev builds (user must explicitly switch to development)
    const effectiveEnvironment = isDev ? syncConfig?.environment : undefined;
    const environment = effectiveEnvironment || 'production';
    const config = environment === 'production' ? STYTCH_CONFIG.live : STYTCH_CONFIG.test;

    logger.main.info('[SettingsHandlers] Lazy-initializing Stytch for environment:', environment);

    StytchAuth.initializeStytchAuth({
        projectId: config.projectId,
        publicToken: config.publicToken,
        apiBase: config.apiBase,
    });

    stytchInitialized = true;
}

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
    safeHandle('get-sidebar-width', (_event, workspacePath: string) => {
        if (!workspacePath) {
            throw new Error('workspacePath is required for get-sidebar-width');
        }
        return getWorkspaceState(workspacePath).sidebarWidth;
    });

    // Set sidebar width
    safeOn('set-sidebar-width', (_event, payload: { workspacePath: string; width: number }) => {
        if (!payload?.workspacePath) {
            logger.store.warn('[ipc] set-sidebar-width called without workspacePath');
            return;
        }
        updateWorkspaceState(payload.workspacePath, state => {
            state.sidebarWidth = payload.width;
        });
    });

    // Get theme (async)
    safeHandle('get-theme', () => {
        return getTheme();
    });

    // Get theme (sync) - for immediate HTML script use
    // CRITICAL: Must use getThemeSync() to resolve 'system' to actual theme
    safeOn('get-theme-sync', (event) => {
        event.returnValue = getThemeSync();
    });

    // Get app version (from app.getVersion)
    safeHandle('get-app-version', () => {
        const { app } = require('electron');
        return app.getVersion();
    });

    // AI Chat state has been moved to unified workspace state
    // Use workspace:get-state and workspace:update-state instead

    // Completion sound settings
    safeHandle('completion-sound:is-enabled', () => {
        return isCompletionSoundEnabled();
    });

    safeHandle('completion-sound:set-enabled', (_event, enabled: boolean) => {
        setCompletionSoundEnabled(enabled);
    });

    safeHandle('completion-sound:get-type', () => {
        return getCompletionSoundType();
    });

    safeHandle('completion-sound:set-type', (_event, soundType: CompletionSoundType) => {
        setCompletionSoundType(soundType);
    });

    safeHandle('completion-sound:test', (_event, soundType: CompletionSoundType) => {
        const soundService = SoundNotificationService.getInstance();
        soundService.testSound(soundType);
    });

    // Release channel settings
    safeHandle('release-channel:get', () => {
        return getReleaseChannel();
    });

    safeHandle('release-channel:set', (_event, channel: ReleaseChannel) => {
        setReleaseChannel(channel);
        // Reconfigure auto-updater with new channel
        autoUpdaterService.reconfigureFeedURL();
        logger.store.info(`[SettingsHandlers] Release channel changed to ${channel}, auto-updater reconfigured`);
    });

    // Get recent projects
    safeHandle('settings:get-recent-projects', () => {
        return getRecentItems('workspaces');
    });

    // Onboarding state
    safeHandle('onboarding:get', async () => {
        const { getOnboardingState } = await import('../utils/store');
        return getOnboardingState();
    });

    safeHandle('onboarding:update', async (_event, state: Partial<OnboardingState>) => {
        const { updateOnboardingState } = await import('../utils/store');
        updateOnboardingState(state);
    });

    // Feature walkthrough state (shown on first launch)
    safeHandle('feature-walkthrough:is-completed', async () => {
        const { isFeatureWalkthroughCompleted } = await import('../utils/store');
        return isFeatureWalkthroughCompleted();
    });

    safeHandle('feature-walkthrough:set-completed', async (_event, completed: boolean) => {
        const { setFeatureWalkthroughCompleted } = await import('../utils/store');
        setFeatureWalkthroughCompleted(completed);
    });

    // Default AI model settings
    safeHandle('settings:get-default-ai-model', () => {
        return getDefaultAIModel();
    });

    safeHandle('settings:set-default-ai-model', (_event, model: string) => {
        setDefaultAIModel(model);
    });

    // Analytics settings
    safeHandle('analytics:is-enabled', () => {
        return isAnalyticsEnabled();
    });

    safeHandle('analytics:set-enabled', (_event, enabled: boolean) => {
        setAnalyticsEnabled(enabled);
    });

    // MockupLM settings
    safeHandle('mockupLM:is-enabled', () => {
        return isMockupLMEnabled();
    });

    safeHandle('mockupLM:set-enabled', (_event, enabled: boolean) => {
        setMockupLMEnabled(enabled);
        logger.store.info(`[SettingsHandlers] MockupLM ${enabled ? 'enabled' : 'disabled'}`);
    });

    // Claude Code settings
    safeHandle('claudeCode:get-settings', async () => {
        const { getClaudeCodeSettings } = await import('../utils/store');
        return getClaudeCodeSettings();
    });

    safeHandle('claudeCode:set-project-commands-enabled', async (_event, enabled: boolean) => {
        const { setClaudeCodeProjectCommandsEnabled } = await import('../utils/store');
        setClaudeCodeProjectCommandsEnabled(enabled);
        logger.store.info(`[SettingsHandlers] Claude Code project commands ${enabled ? 'enabled' : 'disabled'}`);
    });

    safeHandle('claudeCode:set-user-commands-enabled', async (_event, enabled: boolean) => {
        const { setClaudeCodeUserCommandsEnabled } = await import('../utils/store');
        setClaudeCodeUserCommandsEnabled(enabled);
        logger.store.info(`[SettingsHandlers] Claude Code user commands ${enabled ? 'enabled' : 'disabled'}`);
    });

    // Extension Development Kit (EDK) settings
    safeHandle('extensionDevTools:is-enabled', () => {
        return isExtensionDevToolsEnabled();
    });

    safeHandle('extensionDevTools:set-enabled', async (_event, enabled: boolean) => {
        setExtensionDevToolsEnabled(enabled);
        logger.store.info(`[SettingsHandlers] Extension dev tools ${enabled ? 'enabled' : 'disabled'}`);

        // Start or stop the ExtensionDevService based on the new setting
        const { ExtensionDevService } = await import('../services/ExtensionDevService');
        const service = ExtensionDevService.getInstance();

        if (enabled) {
            await service.start();
        } else {
            await service.shutdown();
        }
    });

    safeHandle('extensionDevTools:get-logs', async (_event, filter?: {
        extensionId?: string;
        lastSeconds?: number;
        logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'all';
        source?: 'renderer' | 'main' | 'build' | 'all';
    }) => {
        const { ExtensionLogService } = await import('../services/ExtensionLogService');
        const logService = ExtensionLogService.getInstance();

        const logs = logService.getLogs({
            extensionId: filter?.extensionId,
            lastSeconds: filter?.lastSeconds ?? 300, // Default to 5 minutes for UI
            logLevel: filter?.logLevel ?? 'all',
            source: filter?.source ?? 'all',
        });

        const stats = logService.getStats();

        return { logs, stats };
    });

    safeHandle('extensionDevTools:clear-logs', async (_event, extensionId?: string) => {
        const { ExtensionLogService } = await import('../services/ExtensionLogService');
        const logService = ExtensionLogService.getInstance();

        if (extensionId) {
            logService.clearForExtension(extensionId);
        } else {
            logService.clear();
        }
    });

    safeHandle('extensionDevTools:get-process-info', () => {
        // Return process start time as epoch milliseconds
        const uptimeSeconds = process.uptime();
        const startTime = Date.now() - (uptimeSeconds * 1000);
        return {
            startTime,
            uptimeSeconds,
        };
    });

    // App restart (used by extension dev mode)
    safeHandle('app:restart', async () => {
        const { app } = await import('electron');
        const path = await import('path');
        const fs = await import('fs');

        // Check if we're in dev mode (electron-vite spawns both vite and electron)
        const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL;

        if (isDev) {
            // In dev mode, write a restart signal file and quit.
            // The outer dev-loop.sh script watches for this file and restarts npm run dev.
            const workingDir = app.getAppPath();
            const restartSignalPath = path.join(workingDir, '.restart-requested');

            logger.store.info(`[app:restart] Dev mode restart: writing signal to ${restartSignalPath}`);

            fs.writeFileSync(restartSignalPath, Date.now().toString(), 'utf8');

            // Give the file a moment to be written, then quit
            setTimeout(() => {
                app.quit();
            }, 100);

            return { success: true, mode: 'dev' };
        } else {
            // In production, use the standard relaunch mechanism
            app.relaunch();
            app.exit(0);

            return { success: true, mode: 'production' };
        }
    });

    // Session sync settings
    safeHandle('sync:get-config', () => {
        return getSessionSyncConfig();
    });

    safeHandle('sync:set-config', async (_event, config: SessionSyncConfig | null) => {
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

    safeHandle('sync:test-connection', async (_event, config: SessionSyncConfig) => {
        // Simple test - try to connect to the health endpoint
        if (!config.serverUrl) {
            return { success: false, error: 'Server URL is required' };
        }

        // Require Stytch authentication
        const jwt = StytchAuth.getSessionJwt();
        if (!jwt) {
            return { success: false, error: 'Not authenticated. Please sign in first.' };
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
                    'Authorization': `Bearer ${jwt}`,
                },
                signal: AbortSignal.timeout(5000),
            });

            if (response.ok) {
                // CollabV3 returns plain text "OK"
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
    safeHandle('sync:get-devices', async () => {
        const config = getSessionSyncConfig();

        if (!config?.enabled || !config.serverUrl) {
            return { success: false, devices: [], error: 'Sync not configured' };
        }

        // Require Stytch authentication
        const jwt = StytchAuth.getSessionJwt();
        if (!jwt) {
            return { success: false, devices: [], error: 'Not authenticated' };
        }

        try {
            // Fetch via the /api/sessions endpoint which forwards to IndexRoom status
            const httpUrl = config.serverUrl
                .replace(/^ws:/, 'http:')
                .replace(/^wss:/, 'https:')
                .replace(/\/$/, '');

            const response = await fetch(`${httpUrl}/api/sessions`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${jwt}`,
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
    safeHandle('sync:get-status', async (_event, workspacePath?: string) => {
        const config = getSessionSyncConfig();

        // Lazy init Stytch to check auth status
        ensureStytchInitialized();

        // Sync is "configured" if the user is authenticated with Stytch
        // The serverUrl is derived from environment (defaults to wss://sync.nimbalyst.com)
        // so we don't need to check config.serverUrl anymore
        if (!StytchAuth.isAuthenticated()) {
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
        // If no enabledProjects list, all projects are enabled by default
        const isProjectEnabled = !config?.enabledProjects ||
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
            userEmail: StytchAuth.getUserEmail(),
        };
    });

    // Toggle sync for a specific project
    safeHandle('sync:toggle-project', async (_event, workspacePath: string, enabled: boolean) => {
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

        // If a project was enabled, trigger an incremental sync to push its sessions
        if (enabled) {
            try {
                const { triggerIncrementalSync } = await import('../services/SyncManager');
                // Run async - don't block the IPC response
                triggerIncrementalSync().catch(err => {
                    logger.store.error('[sync:toggle-project] Failed to trigger sync:', err);
                });
            } catch (err) {
                logger.store.error('[sync:toggle-project] Failed to import SyncManager:', err);
            }
        }

        return { success: true };
    });

    // Subscribe to sync status changes and broadcast to all windows
    // This is called once when the first window requests it
    safeHandle('sync:subscribe-status', () => {
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
    // Credential Management (for E2E encryption key)
    // ============================================================

    // Get encryption key info (for sync pairing)
    safeHandle('credentials:get', () => {
        const creds = getCredentials();
        return {
            encryptionKeySeed: creds.encryptionKeySeed,
            createdAt: creds.createdAt,
            isSecure: isUsingSecureStorage(),
        };
    });

    // Reset encryption key (generates new one - invalidates paired devices)
    safeHandle('credentials:reset', () => {
        const creds = resetCredentials();
        return {
            encryptionKeySeed: creds.encryptionKeySeed,
            createdAt: creds.createdAt,
            isSecure: isUsingSecureStorage(),
        };
    });

    // Generate QR pairing payload for mobile device
    safeHandle('credentials:generate-qr-payload', (_event, serverUrl: string) => {
        if (!serverUrl) {
            throw new Error('serverUrl is required for QR pairing');
        }
        return generateQRPairingPayload(serverUrl);
    });

    // Check if secure storage (keychain) is available
    safeHandle('credentials:is-secure', () => {
        return isUsingSecureStorage();
    });

    // Get local network IP for mobile pairing with local dev server
    safeHandle('network:get-local-ip', () => {
        return getLocalNetworkIP();
    });

    // ============================================================
    // Stytch Authentication (for account-based sync)
    // ============================================================

    // Get current Stytch auth state
    safeHandle('stytch:get-auth-state', () => {
        ensureStytchInitialized();
        return StytchAuth.getAuthState();
    });

    // Check if user is authenticated with Stytch
    safeHandle('stytch:is-authenticated', () => {
        ensureStytchInitialized();
        return StytchAuth.isAuthenticated();
    });

    // Sign in with Google OAuth
    safeHandle('stytch:sign-in-google', async () => {
        ensureStytchInitialized();
        // Get the sync server URL from settings
        const syncConfig = getSessionSyncConfig();
        const isDev = process.env.NODE_ENV !== 'production';

        // Only honor environment config in dev builds - production builds always use production
        const effectiveEnvironment = isDev ? syncConfig?.environment : undefined;

        // Derive server URL from environment - don't rely on persisted serverUrl
        let serverUrl: string;
        if (effectiveEnvironment === 'development') {
            serverUrl = 'ws://localhost:8790';
        } else {
            // Production is the default (for both prod builds and when not explicitly set in dev)
            serverUrl = 'wss://sync.nimbalyst.com';
        }

        // Convert WebSocket URLs to HTTP: wss:// -> https://, ws:// -> http://
        const httpUrl = serverUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
        logger.main.info('[stytch:sign-in-google] Auth URL:', httpUrl, 'effectiveEnvironment:', effectiveEnvironment);
        return StytchAuth.signInWithGoogle(httpUrl);
    });

    // Send magic link for passwordless authentication
    safeHandle('stytch:send-magic-link', async (_event, email: string) => {
        ensureStytchInitialized();
        if (!email) {
            return { success: false, error: 'Email is required' };
        }
        // Get the sync server URL from settings
        const syncConfig = getSessionSyncConfig();
        const isDev = process.env.NODE_ENV !== 'production';

        // Only honor environment config in dev builds - production builds always use production
        const effectiveEnvironment = isDev ? syncConfig?.environment : undefined;

        // Derive server URL from environment - don't rely on persisted serverUrl
        let serverUrl: string;
        if (effectiveEnvironment === 'development') {
            serverUrl = 'ws://localhost:8790';
        } else {
            // Production is the default (for both prod builds and when not explicitly set in dev)
            serverUrl = 'wss://sync.nimbalyst.com';
        }

        // Convert WebSocket URLs to HTTP: wss:// -> https://, ws:// -> http://
        const httpUrl = serverUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
        logger.main.info('[stytch:send-magic-link] Sending to:', httpUrl, 'effectiveEnvironment:', effectiveEnvironment);
        return StytchAuth.sendMagicLink(email, httpUrl);
    });

    // Sign out
    safeHandle('stytch:sign-out', async () => {
        ensureStytchInitialized();
        await StytchAuth.signOut();
        return { success: true };
    });

    // Get session JWT for server authentication
    safeHandle('stytch:get-session-jwt', () => {
        ensureStytchInitialized();
        return StytchAuth.getSessionJwt();
    });

    // Validate and refresh the current session
    safeHandle('stytch:refresh-session', async () => {
        ensureStytchInitialized();
        return StytchAuth.validateAndRefreshSession();
    });

    // Subscribe to auth state changes
    safeHandle('stytch:subscribe-auth-state', () => {
        ensureStytchInitialized();
        // Set up listener to broadcast auth state changes to all windows
        StytchAuth.onAuthStateChange((state) => {
            for (const window of BrowserWindow.getAllWindows()) {
                window.webContents.send('stytch:auth-state-changed', state);
            }
        });
        return StytchAuth.getAuthState();
    });

    // Switch Stytch environment (dev only - signs out and switches to test/live)
    safeHandle('stytch:switch-environment', async (_event, environment: 'development' | 'production') => {
        try {
            // Reset initialized flag so next call re-initializes with new environment
            stytchInitialized = false;
            await StytchAuth.switchStytchEnvironment(environment);
            stytchInitialized = true; // Mark as initialized after switch
            return { success: true };
        } catch (error) {
            logger.main.error('[Settings] Failed to switch Stytch environment:', error);
            return { success: false, error: String(error) };
        }
    });
}

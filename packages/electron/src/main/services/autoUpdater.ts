import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, dialog } from 'electron';
import log from 'electron-log/main';
import { getReleaseChannel, store } from '../utils/store';
import { safeHandle, safeOn } from '../utils/ipcRegistry';
import { AnalyticsService } from './analytics/AnalyticsService';

// Reminder suppression duration: 24 hours
const REMINDER_SUPPRESSION_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Categorize download duration for analytics
 */
function getDurationCategory(durationMs: number): string {
  if (durationMs < 30000) return 'fast';       // < 30 seconds
  if (durationMs < 120000) return 'medium';    // 30s - 2 minutes
  return 'slow';                                // > 2 minutes
}

/**
 * Classify update errors for analytics
 */
function classifyUpdateError(error: Error): string {
  const message = error.message.toLowerCase();
  if (message.includes('network') || message.includes('enotfound') || message.includes('timeout') || message.includes('econnrefused')) {
    return 'network';
  }
  if (message.includes('permission') || message.includes('eacces')) {
    return 'permission';
  }
  if (message.includes('disk') || message.includes('space') || message.includes('enospc')) {
    return 'disk_space';
  }
  if (message.includes('signature') || message.includes('verify')) {
    return 'signature';
  }
  return 'unknown';
}

export class AutoUpdaterService {
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private isCheckingForUpdate = false;
  private isManualCheck = false; // Track if this is a user-initiated check (for showing up-to-date toast)
  private static isUpdating = false;
  private pendingUpdateInfo: { version: string; releaseNotes?: string; releaseDate?: string } | null = null;
  private downloadStartTime: number | null = null; // Track download start time for duration analytics

  constructor() {
    // Configure electron-updater logger
    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // Configure feed URL based on release channel
    this.configureFeedURL();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up IPC handlers for renderer communication
    this.setupIpcHandlers();
  }

  private configureFeedURL() {
    const channel = getReleaseChannel();

    if (channel === 'alpha') {
      // Alpha channel: Use Cloudflare R2 bucket
      const alphaFeedURL = 'https://pub-4357a3345db7463580090984c0e4e2ba.r2.dev/';
      log.info(`Configuring alpha channel updates from: ${alphaFeedURL}`);
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: alphaFeedURL
      });
    } else {
      // Stable channel: Use GitHub releases (default)
      log.info('Configuring stable channel updates from GitHub');
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'nimbalyst',
        repo: 'nimbalyst'
      });
    }
  }

  private setupEventHandlers() {
    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for update...');
      this.isCheckingForUpdate = true;
      this.sendToAllWindows('update-checking');
    });

    autoUpdater.on('update-available', async (info) => {
      log.info('Update available:', info);
      this.isCheckingForUpdate = false;
      this.isManualCheck = false; // Reset manual check flag

      // Fetch release notes from R2 if using alpha channel
      let releaseNotes = info.releaseNotes as string | undefined;
      const channel = getReleaseChannel();
      log.info(`Release channel: ${channel}, releaseNotes from info: "${releaseNotes}"`);

      // Always fetch release notes from R2 for alpha channel
      // The latest-mac.yml doesn't include releaseNotes, so we need to fetch it separately
      if (channel === 'alpha') {
        try {
          const releaseNotesURL = 'https://pub-4357a3345db7463580090984c0e4e2ba.r2.dev/RELEASE_NOTES.md';
          log.info(`Fetching release notes from: ${releaseNotesURL}`);
          const response = await fetch(releaseNotesURL);
          if (response.ok) {
            releaseNotes = await response.text();
            log.info('Successfully fetched release notes from R2');
            log.info(`Release notes length: ${releaseNotes.length} characters`);
          } else {
            log.warn(`Failed to fetch release notes: ${response.status}`);
          }
        } catch (err) {
          log.error('Error fetching release notes from R2:', err);
        }
      } else {
        log.info('Not fetching from R2 - either not alpha channel or releaseNotes already present');
      }

      log.info(`Final releaseNotes being sent to window: "${releaseNotes?.substring(0, 100)}..."`);

      // Store pending update info for later use
      this.pendingUpdateInfo = {
        version: info.version,
        releaseNotes: releaseNotes,
        releaseDate: info.releaseDate
      };

      // Send to frontmost window via toast system
      this.sendToFrontmostWindow('update-toast:show-available', {
        currentVersion: app.getVersion(),
        newVersion: info.version,
        releaseNotes: releaseNotes,
        releaseDate: info.releaseDate,
        isManualCheck: this.isManualCheck
      });

      // Track update toast shown
      AnalyticsService.getInstance().sendEvent('update_toast_shown', {
        release_channel: channel,
        new_version: info.version
      });

      this.sendToAllWindows('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info);
      this.isCheckingForUpdate = false;
      // Only show up-to-date toast for manual (user-initiated) checks
      if (this.isManualCheck) {
        this.sendToFrontmostWindow('update-toast:up-to-date');
        this.isManualCheck = false;
      }
      this.sendToAllWindows('update-not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err);
      this.isCheckingForUpdate = false;
      this.isManualCheck = false; // Reset manual check flag

      // Track update error - determine stage based on context
      // If downloadStartTime is set, we were downloading; otherwise it was a check error
      const stage = this.downloadStartTime ? 'download' : 'check';
      AnalyticsService.getInstance().sendEvent('update_error', {
        stage,
        error_type: classifyUpdateError(err),
        release_channel: getReleaseChannel()
      });
      this.downloadStartTime = null;

      // Send error to frontmost window via toast system
      this.sendToFrontmostWindow('update-toast:error', {
        message: err.message
      });

      this.sendToAllWindows('update-error', err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      let logMessage = `Download speed: ${progressObj.bytesPerSecond}`;
      logMessage = `${logMessage} - Downloaded ${progressObj.percent}%`;
      logMessage = `${logMessage} (${progressObj.transferred}/${progressObj.total})`;
      log.info(logMessage);

      // Send progress to frontmost window via toast system
      this.sendToFrontmostWindow('update-toast:progress', {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total
      });

      this.sendToAllWindows('update-download-progress', progressObj);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info);

      // Track download completed with duration
      const downloadDuration = this.downloadStartTime ? Date.now() - this.downloadStartTime : 0;
      AnalyticsService.getInstance().sendEvent('update_download_completed', {
        release_channel: getReleaseChannel(),
        new_version: info.version,
        duration_category: getDurationCategory(downloadDuration)
      });
      this.downloadStartTime = null;

      // Send ready notification to frontmost window via toast system
      this.sendToFrontmostWindow('update-toast:show-ready', {
        version: info.version
      });

      this.sendToAllWindows('update-downloaded', info);
    });
  }

  /**
   * Get the frontmost (focused) window, or the first workspace window if no window is focused
   */
  private getFrontmostWindow(): BrowserWindow | null {
    // First try to get the focused window
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) {
      return focused;
    }

    // Otherwise, find the first visible workspace window
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed() && win.isVisible()) {
        // Check if it's a workspace window (not update window, settings window, etc.)
        const url = win.webContents.getURL();
        if (!url.includes('mode=') || url.includes('mode=workspace')) {
          return win;
        }
      }
    }

    // Last resort: return the first visible window
    return allWindows.find(w => !w.isDestroyed() && w.isVisible()) || null;
  }

  /**
   * Send a message to the frontmost window
   */
  private sendToFrontmostWindow(channel: string, data?: any) {
    const window = this.getFrontmostWindow();
    if (window && !window.isDestroyed()) {
      log.info(`Sending ${channel} to frontmost window`);
      window.webContents.send(channel, data);
    } else {
      log.warn(`No frontmost window available to send ${channel}`);
    }
  }

  public reconfigureFeedURL() {
    this.configureFeedURL();
  }

  private setupIpcHandlers() {
    safeHandle('check-for-updates', async () => {
      if (this.isCheckingForUpdate) {
        return { checking: true };
      }

      try {
        const result = await autoUpdater.checkForUpdatesAndNotify();
        return result;
      } catch (error) {
        log.error('Failed to check for updates:', error);
        throw error;
      }
    });

    safeHandle('download-update', async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        log.error('Failed to download update:', error);
        throw error;
      }
    });

    safeHandle('quit-and-install', () => {
      setImmediate(() => {
        try {
          log.info('IPC: Attempting to quit and install update...');
          // Set flag to bypass quit prevention
          AutoUpdaterService.isUpdating = true;
          // Force remove all before-quit listeners that might prevent quit
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          // Now quit and install
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          log.error('Failed to quit and install update:', error);
          // Fallback to force quit
          AutoUpdaterService.isUpdating = true;
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          app.relaunch();
          app.exit(0);
        }
      });
    });

    safeHandle('get-current-version', () => {
      return app.getVersion();
    });

    // Toast-based update IPC handlers
    safeOn('update-toast:download', async () => {
      try {
        log.info('Update toast: Starting download...');

        // Track download started (user action tracking is done in renderer)
        this.downloadStartTime = Date.now();
        AnalyticsService.getInstance().sendEvent('update_download_started', {
          release_channel: getReleaseChannel(),
          new_version: this.pendingUpdateInfo?.version || 'unknown'
        });

        // In test mode, skip the actual download (tests will manually trigger progress)
        if (process.env.NODE_ENV !== 'test' && process.env.PLAYWRIGHT !== '1') {
          // Re-check for the latest version before downloading in case a newer update
          // was released while the update window was sitting idle
          await this.checkAndDownloadLatest();
        } else {
          log.info('Test mode: Skipping actual download');
        }
      } catch (error) {
        log.error('Failed to download update from toast:', error);

        // Track download error
        AnalyticsService.getInstance().sendEvent('update_error', {
          stage: 'download',
          error_type: classifyUpdateError(error instanceof Error ? error : new Error(String(error))),
          release_channel: getReleaseChannel()
        });

        this.sendToFrontmostWindow('update-toast:error', {
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    safeOn('update-toast:install', () => {
      log.info('Update toast: Installing update...');

      // Track install initiated
      AnalyticsService.getInstance().sendEvent('update_install_initiated', {
        new_version: this.pendingUpdateInfo?.version || 'unknown'
      });

      setImmediate(() => {
        try {
          // Set flag to bypass quit prevention
          AutoUpdaterService.isUpdating = true;
          // Force remove all before-quit listeners that might prevent quit
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          // Now quit and install
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          log.error('Failed to quit and install:', error);

          // Track install error
          AnalyticsService.getInstance().sendEvent('update_error', {
            stage: 'install',
            error_type: classifyUpdateError(error instanceof Error ? error : new Error(String(error))),
            release_channel: getReleaseChannel()
          });

          // Fallback to force quit
          AutoUpdaterService.isUpdating = true;
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          app.relaunch();
          app.exit(0);
        }
      });
    });

    // Reminder suppression handlers
    safeHandle('update:check-reminder-suppression', (_event, version: string) => {
      const dismissedVersion = store.get('updateDismissedVersion');
      const dismissedAt = store.get('updateDismissedAt') as number | undefined;

      if (dismissedVersion !== version) {
        // Different version, don't suppress
        return { suppressed: false };
      }

      if (!dismissedAt) {
        return { suppressed: false };
      }

      const timeSinceDismissal = Date.now() - dismissedAt;
      if (timeSinceDismissal < REMINDER_SUPPRESSION_DURATION_MS) {
        log.info(`Update reminder suppressed for version ${version} (${Math.round(timeSinceDismissal / 1000 / 60)} minutes ago)`);
        return { suppressed: true };
      }

      // Suppression expired
      return { suppressed: false };
    });

    safeHandle('update:set-reminder-suppression', (_event, version: string) => {
      store.set('updateDismissedVersion', version);
      store.set('updateDismissedAt', Date.now());
      log.info(`Update reminder suppressed for version ${version}`);
      // User action tracking is done in renderer
      return { success: true };
    });
  }

  private sendToAllWindows(channel: string, data?: any) {
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send(channel, data);
    });
  }

  public startAutoUpdateCheck(intervalMinutes = 60) {
    // Initial check after 30 seconds
    setTimeout(() => {
      this.checkForUpdates();
    }, 30000);

    // Set up periodic checks
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMinutes * 60 * 1000);
  }

  public stopAutoUpdateCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  public static isUpdatingApp(): boolean {
    return AutoUpdaterService.isUpdating;
  }

  public async checkForUpdates() {
    if (this.isCheckingForUpdate) {
      log.info('Already checking for updates, skipping...');
      return;
    }

    try {
      log.info('Checking for updates...');
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      log.error('Failed to check for updates:', error);
    }
  }

  public async checkForUpdatesWithUI() {
    if (this.isCheckingForUpdate) {
      // Already checking, don't show anything - the checking toast is already visible
      return;
    }

    // In dev mode (not packaged), electron-updater skips the check without firing events
    // Show appropriate feedback to the user
    if (!app.isPackaged) {
      log.info('Skipping update check in dev mode (app not packaged)');
      this.sendToFrontmostWindow('update-toast:checking');
      // Brief delay so user sees the checking state, then show error
      setTimeout(() => {
        this.sendToFrontmostWindow('update-toast:error', {
          message: 'Update checking is not available in development mode'
        });
      }, 500);
      return;
    }

    // Mark this as a manual check so the event handlers know to show UI feedback
    this.isManualCheck = true;

    // Show checking toast
    this.sendToFrontmostWindow('update-toast:checking');

    try {
      // checkForUpdates() will fire either 'update-available' or 'update-not-available' events
      // The event handlers will send the appropriate toast messages
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.error('Failed to check for updates:', error);
      this.isManualCheck = false;
      this.sendToFrontmostWindow('update-toast:error', {
        message: error instanceof Error ? error.message : 'Failed to check for updates'
      });
    }
  }

  private async checkAndDownloadLatest() {
    try {
      log.info('Re-checking for latest version before download...');

      // Check for the absolute latest version
      const result = await autoUpdater.checkForUpdates();

      if (result && result.updateInfo) {
        log.info(`Latest version found: ${result.updateInfo.version}, downloading...`);

        // Download the latest version that was just checked
        // Progress events will update the toast automatically
        await autoUpdater.downloadUpdate();
      } else {
        log.info('No update found during re-check');
        // Show up-to-date toast (rare edge case - update was released then pulled)
        this.sendToFrontmostWindow('update-toast:up-to-date');
      }
    } catch (error) {
      log.error('Failed to check and download latest:', error);
      this.sendToFrontmostWindow('update-toast:error', {
        message: error instanceof Error ? error.message : 'Failed to download the update'
      });
    }
  }
}

// Export singleton instance
export const autoUpdaterService = new AutoUpdaterService();

// Test helpers - only used in test environment
if (process.env.NODE_ENV === 'test' || process.env.PLAYWRIGHT === '1') {
  safeHandle('test:trigger-update-available', (_event, updateInfo: { version: string; releaseNotes?: string; releaseDate?: string }) => {
    log.info('Test: Triggering update available');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:show-available', {
        currentVersion: app.getVersion(),
        newVersion: updateInfo.version,
        releaseNotes: updateInfo.releaseNotes || '',
        releaseDate: updateInfo.releaseDate
      });
    }
  });

  safeHandle('test:trigger-download-progress', (_event, progress: { bytesPerSecond: number; percent: number; transferred: number; total: number }) => {
    log.info(`Test: Triggering download progress ${progress.percent}%`);
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:progress', progress);
    }
  });

  safeHandle('test:trigger-update-ready', (_event, updateInfo: { version: string }) => {
    log.info('Test: Triggering update ready');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:show-ready', {
        version: updateInfo.version
      });
    }
  });

  safeHandle('test:trigger-update-error', (_event, errorMessage: string) => {
    log.info('Test: Triggering update error');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:error', {
        message: errorMessage
      });
    }
  });

  safeHandle('test:trigger-update-checking', () => {
    log.info('Test: Triggering update checking');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:checking');
    }
  });

  safeHandle('test:trigger-update-up-to-date', () => {
    log.info('Test: Triggering up to date');
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused || BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.isVisible());
    if (window && !window.isDestroyed()) {
      window.webContents.send('update-toast:up-to-date');
    }
  });

  safeHandle('test:clear-update-suppression', () => {
    log.info('Test: Clearing update suppression');
    store.delete('updateDismissedVersion');
    store.delete('updateDismissedAt');
  });
}

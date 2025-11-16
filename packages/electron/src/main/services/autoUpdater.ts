import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import log from 'electron-log';
import { showUpdateAvailable, showDownloadProgress, showUpdateReady, showUpdateError, closeUpdateWindow } from '../window/UpdateWindow';
import { getReleaseChannel } from '../utils/store';

export class AutoUpdaterService {
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private isCheckingForUpdate = false;
  private static isUpdating = false;

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

    autoUpdater.on('update-available', (info) => {
      log.info('Update available:', info);
      this.isCheckingForUpdate = false;

      // Show custom update window
      showUpdateAvailable({
        version: info.version,
        releaseNotes: info.releaseNotes as string,
        releaseDate: info.releaseDate
      });

      this.sendToAllWindows('update-available', info);
    });

    autoUpdater.on('update-not-available', (info) => {
      log.info('Update not available:', info);
      this.isCheckingForUpdate = false;
      this.sendToAllWindows('update-not-available', info);
    });

    autoUpdater.on('error', (err) => {
      log.error('Update error:', err);
      this.isCheckingForUpdate = false;

      // Show error in update window
      showUpdateError(err.message);

      this.sendToAllWindows('update-error', err.message);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      let logMessage = `Download speed: ${progressObj.bytesPerSecond}`;
      logMessage = `${logMessage} - Downloaded ${progressObj.percent}%`;
      logMessage = `${logMessage} (${progressObj.transferred}/${progressObj.total})`;
      log.info(logMessage);

      // Update the update window with progress
      showDownloadProgress({
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total
      });

      this.sendToAllWindows('update-download-progress', progressObj);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info('Update downloaded:', info);

      // Show update ready state in update window
      showUpdateReady({
        version: info.version,
        releaseNotes: info.releaseNotes as string,
        releaseDate: info.releaseDate
      });

      this.sendToAllWindows('update-downloaded', info);
    });
  }

  public reconfigureFeedURL() {
    this.configureFeedURL();
  }

  private setupIpcHandlers() {
    ipcMain.handle('check-for-updates', async () => {
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

    ipcMain.handle('download-update', async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (error) {
        log.error('Failed to download update:', error);
        throw error;
      }
    });

    ipcMain.handle('quit-and-install', () => {
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

    ipcMain.handle('get-current-version', () => {
      return app.getVersion();
    });

    // Update window IPC handlers
    ipcMain.on('update-window:download', async () => {
      try {
        log.info('Update window: Starting download...');
        // In test mode, skip the actual download (tests will manually trigger progress)
        if (process.env.NODE_ENV !== 'test' && process.env.PLAYWRIGHT !== '1') {
          await autoUpdater.downloadUpdate();
        } else {
          log.info('Test mode: Skipping actual download');
        }
      } catch (error) {
        log.error('Failed to download update from update window:', error);
        showUpdateError(error instanceof Error ? error.message : 'Unknown error');
      }
    });

    ipcMain.on('update-window:install', () => {
      log.info('Update window: Installing update...');
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
          // Fallback to force quit
          AutoUpdaterService.isUpdating = true;
          app.removeAllListeners('before-quit');
          app.removeAllListeners('window-all-closed');
          app.relaunch();
          app.exit(0);
        }
      });
    });

    ipcMain.on('update-window:dismiss', () => {
      log.info('Update window: Dismissed');
      closeUpdateWindow();
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
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Check',
        message: 'Already checking for updates...',
        buttons: ['OK']
      });
      return;
    }

    try {
      const result = await autoUpdater.checkForUpdates();

      if (!result || !result.updateInfo) {
        dialog.showMessageBox({
          type: 'info',
          title: 'No Updates',
          message: 'You are running the latest version.',
          buttons: ['OK']
        });
      }
    } catch (error) {
      log.error('Failed to check for updates:', error);
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Failed to check for updates.',
        detail: error instanceof Error ? error.message : 'Unknown error',
        buttons: ['OK']
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

        // Show a quick info that we're downloading the latest version
        // This is non-blocking and will be replaced by the download progress
        this.sendToAllWindows('update-checking-latest', {
          message: `Downloading latest version ${result.updateInfo.version}...`
        });

        // Download the latest version that was just checked
        await autoUpdater.downloadUpdate();
      } else {
        log.info('No update found during re-check');
        dialog.showMessageBox({
          type: 'info',
          title: 'Up to Date',
          message: 'You already have the latest version.',
          buttons: ['OK']
        });
      }
    } catch (error) {
      log.error('Failed to check and download latest:', error);
      dialog.showMessageBox({
        type: 'error',
        title: 'Download Failed',
        message: 'Failed to download the latest update.',
        detail: error instanceof Error ? error.message : 'Unknown error',
        buttons: ['OK']
      });
    }
  }
}

// Export singleton instance
export const autoUpdaterService = new AutoUpdaterService();
